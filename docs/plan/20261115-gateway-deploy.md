# 自托管 OpenBuddy 网关

> 对应 `docs/plan/20261115-mobile.md` Phase 1.6：网关的 Docker 镜像与部署说明。
> 网关是手机 ↔ 桌面之间的中继。桌面只做出站连接，所以网关可以放在公网、
> 家里的小主机，或任何一台能被手机和桌面同时访问到的机器上。

---

## 1. 一条命令跑起来

```bash
cd packages/gateway
docker build -t openbuddy-gateway .

docker run -d --name openbuddy-gateway \
  -p 8787:8787 \
  -e GATEWAY_ADMIN_TOKEN="$(openssl rand -hex 24)" \
  -e GATEWAY_AGENT_TOKEN="$(openssl rand -hex 24)" \
  -e GATEWAY_PAIR_ALLOW_SHARED=1 \
  -v openbuddy-gateway:/data \
  openbuddy-gateway
```

启动后：

```bash
curl http://127.0.0.1:8787/health          # {"status":"ok","ok":true}
docker logs openbuddy-gateway | head        # 打印 admin/agent token 的来源
```

`/data` 是卷，sqlite（配对码、设备令牌、审计、推送注册）都在里面；重建容器
不会让已配对的手机失效。

## 2. 桌面端接入

桌面需要知道两件事：网关地址，和 agent token。在**启动桌面之前**设置环境变量：

```bash
export OPENBUDDY_GATEWAY_URL="https://gw.example.com"
export OPENBUDDY_GATEWAY_AGENT_TOKEN="<GATEWAY_AGENT_TOKEN>"
openbuddy            # 或打包后的 app
```

没有设置 `OPENBUDDY_GATEWAY_URL` 时，桌面不会开任何端口，行为与从前完全一致
——手机接入是可选能力。

桌面上电后会在日志里打印：

```
[mobile-bridge] serving http://127.0.0.1:54321 for gateway https://gw.example.com
```

## 3. 手机配对

1. 网关的 admin 控制台（`/ui`，用 `GATEWAY_ADMIN_TOKEN` 登录）或桌面端发起
   一次配对，拿到 8 位码。
2. 手机 OpenBuddy → 配对页 → 扫码或手输：
   - **网关地址**：`https://gw.example.com`
   - **配对码**：8 位数字
3. 配对成功后，设备令牌存在手机钥匙串（Keychain / Keystore），不会出设备。

## 4. 环境变量

| 变量 | 默认 | 含义 |
|---|---|---|
| `GATEWAY_HOST` | `0.0.0.0` | 监听地址 |
| `GATEWAY_PORT` | `8787` | 监听端口 |
| `GATEWAY_ADMIN_TOKEN` | 随机生成 | 运营/管理面令牌 |
| `GATEWAY_AGENT_TOKEN` | 随机生成 | 桌面接入网关用的令牌 |
| `GATEWAY_PUBLIC_URL` | — | 对外地址（生成二维码用） |
| `GATEWAY_DB` | `/data/openbuddy.sqlite` | sqlite 路径 |
| `GATEWAY_PAIR_ALLOW_SHARED` | `0` | `1` = 允许配对到"任意在线桌面"（共享路由） |
| `GATEWAY_PAIR_TTL_MS` | `120000` | 配对码有效期 |
| `GATEWAY_CLAIM_LIMIT` | `10` | 每分钟认领次数上限 |
| `GATEWAY_MAX_BODY_BYTES` | `20971520` | 单次请求体上限（相机图片走这条） |
| `GATEWAY_REQUIRE_TLS` | — | 生产环境应在网关前置 TLS |
| `GATEWAY_H5` / `GATEWAY_H5_DIR` | `1` / 内置 | H5 客户端托管开关与目录 |
| `GATEWAY_EXPO_ACCESS_TOKEN` | — | 可选，提高 Expo 推送配额 |
| `GATEWAY_FCM_SERVICE_ACCOUNT` | — | 可选，Firebase 推送 |
| `GATEWAY_WEBHOOK_TOKEN` | — | 可选，webhook 推送的共享密钥 |
| `GATEWAY_PUSH_WATCH_INTERVAL_MS` | `5000` | 会话状态轮询间隔 |

## 5. 放在公网时

- **必须 TLS**：网关前面放 Caddy / nginx / Cloudflare，终止 TLS 后回环到
  `127.0.0.1:8787`。
- **共享路由要关**：`GATEWAY_PAIR_ALLOW_SHARED=0`（默认）时，手机配对会绑定到
  一台指定的桌面；只有"一台桌面服务多个手机"才打开它。
- **限流已内置**：设备与 IP 双桶，认证后才计费。
- **审计**：`/admin/audit` 能看到每次配对、认领、隧道请求。

## 6. 验证

```bash
# 网关自身
cd packages/gateway && bun test                 # 354+ 测试

# 端到端（网关 + 桌面桥 + 手机）
bun run scripts/e2e-mobile.ts                    # 协议桥
bun run scripts/e2e-mobile-app.ts                # App 逻辑层
node scripts/run-desktop-bridge-e2e.mjs          # 桌面自己的桥

# 针对一个已经在跑的网关（容器 / 远端）跑同一条链路
OPENBUDDY_E2E_GATEWAY='{"url":"https://gw.example.com","adminToken":"…","agentToken":"…"}' \
  node scripts/run-desktop-bridge-e2e.mjs
```

## 7. 排错

| 现象 | 多半是 |
|---|---|
| 手机一直"正在连接电脑" | 桌面没设 `OPENBUDDY_GATEWAY_URL`，或 agent token 不对 |
| 网关返回 503 `desktop_offline` | 桌面断开了；桌面只做出站连接，被墙/断网都会掉 |
| 配对码被拒 | 过期（默认 2 分钟）或超过认领频率上限 |
| 图片发不出去 | 桌面没给桥接开上传目录，或图片超过 `GATEWAY_MAX_BODY_BYTES` |
| `/health` 正常但手机连不上 | 手机侧走的是 `/api/*`；检查反向代理是否剥掉了 `/api` 前缀 |
