#!/usr/bin/env bash
# 只读诊断 Casdoor Application 的 OIDC、短信和微信登录前置条件。
# 不需要管理员密码，也不会输出 client secret 或 provider secret。
#
#   CASDOOR_ENDPOINT=http://127.0.0.1:8000 \
#   CASDOOR_CLIENT_ID=openbuddy \
#   CASDOOR_REDIRECT_URI=casdoor://localhost/callback \
#   bash scripts/diagnose-casdoor-app.sh

set -euo pipefail

CASDOOR_ENDPOINT=${CASDOOR_ENDPOINT:-}
CASDOOR_CLIENT_ID=${CASDOOR_CLIENT_ID:-}
CASDOOR_REDIRECT_URI=${CASDOOR_REDIRECT_URI:-casdoor://localhost/callback}

if [[ -z "${CASDOOR_ENDPOINT}" || -z "${CASDOOR_CLIENT_ID}" ]]; then
  echo "用法：CASDOOR_ENDPOINT=<issuer> CASDOOR_CLIENT_ID=<client-id> [CASDOOR_REDIRECT_URI=casdoor://localhost/callback] bash $0" >&2
  exit 2
fi

for command in curl jq; do
  command -v "${command}" >/dev/null 2>&1 || { echo "缺少依赖：${command}" >&2; exit 2; }
done

endpoint=${CASDOOR_ENDPOINT%/}
payload=$(curl --fail --silent --show-error --max-time 15 \
  --get "${endpoint}/api/get-app-login" \
  --data-urlencode "clientId=${CASDOOR_CLIENT_ID}" \
  --data-urlencode "responseType=code" \
  --data-urlencode "redirectUri=${CASDOOR_REDIRECT_URI}" \
  --data-urlencode "type=code" \
  --data-urlencode "scope=openid profile email phone offline_access")

status=$(jq -r '.status // "unknown"' <<<"${payload}")
if [[ "${status}" != "ok" ]]; then
  echo "Casdoor Application 能力探测失败：$(jq -r '.msg // "unknown error"' <<<"${payload}")" >&2
  exit 1
fi

data=$(jq '.data // {}' <<<"${payload}")
redirect_ok=$(jq --arg uri "${CASDOOR_REDIRECT_URI}" '[.redirectUris[]? | select(. == $uri)] | length > 0' <<<"${data}")
scopes_ok=$(jq '[.scopes[]?] as $scopes | (["openid","profile","email","phone","offline_access"] - $scopes) | length == 0' <<<"${data}")
code_signin=$(jq -r 'if .enableCodeSignin == true then "enabled" else "disabled" end' <<<"${data}")
sms_providers=$(jq -r '[.providers[]? | select(.canSignIn == true and .provider.category == "SMS") | .provider.name // .name] | if length == 0 then "none" else join(", ") end' <<<"${data}")
wechat_providers=$(jq -r '[.providers[]? | select(.canSignIn == true and .provider.category == "OAuth" and .provider.type == "WeChat") | .provider.name // .name] | if length == 0 then "none" else join(", ") end' <<<"${data}")

echo "Casdoor endpoint: ${endpoint}"
echo "Application: ${CASDOOR_CLIENT_ID}"
echo "Redirect URI: ${CASDOOR_REDIRECT_URI} ($( [[ "${redirect_ok}" == true ]] && echo ok || echo missing ))"
echo "OIDC scopes: ($( [[ "${scopes_ok}" == true ]] && echo complete || echo missing ))"
echo "Verification code: ${code_signin}"
echo "SMS Providers: ${sms_providers}"
echo "WeChat Providers: ${wechat_providers}"

if [[ "${redirect_ok}" != true || "${scopes_ok}" != true || "${code_signin}" != enabled || "${sms_providers}" == none || "${wechat_providers}" == none ]]; then
  echo "结论：Casdoor 仍未满足 OpenBuddy 的企业登录前置条件。"
  exit 1
fi

echo "结论：OIDC、短信和微信登录前置条件已满足；仍需使用真实账号完成端到端回调验收。"
