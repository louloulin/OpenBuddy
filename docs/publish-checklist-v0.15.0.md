# v0.15.0 发布 Checklist（2026-08-31）

本 Checklist 是把代码侧的 release bundle 推到生产 `124.221.146.145:8787` 所必须执行的最小动作清单。所有命令都可以直接在操作员本地复制粘贴。**不要在没有勾完前置条件的情况下跳步**。

## 0. 前置条件（必须先全部勾完）

- [ ] 操作员本地有 `bash 5+`、`jq`、`curl`、`openssl`、`tar`、`sha256sum`
- [ ] 操作员本地有 SSH key，名称为生产主机接受的形式（默认 `~/.ssh/id_ed25519`）
- [ ] 密钥已经加入生产主机的 `ubuntu@124.221.146.145`：`ssh -i ~/.ssh/id_ed25519 ubuntu@124.221.146.145 true` 返回 0
- [ ] 生产主机 `124.221.146.145` 的 8787 / 8000 / 3000 端口均能从内网或反向代理访问
- [ ] GitHub 仓库 `https://github.com/louloulin/OpenBuddy.git` 在 push 后触发了 release 流水线（如果不是手动发布 tarball）

## 1. 拉取最新代码 + 创建离线 release bundle

```bash
cd /path/to/OpenBuddy
git fetch origin codex/casdoor
git checkout codex/casdoor
git pull --ff-only origin codex/casdoor
git log --oneline -1   # 期望: your codex/casdoor HEAD short sha
bash scripts/build-release-bundle.sh /tmp/openbuddy-release
ls -la /tmp/openbuddy-release/openbuddy-release-*.tar.gz
```

期望输出：1 个 tarball（51 文件、约 192 KB）、1 个 SHA256SUMS、1 个 manifest.json。

## 2. 选择部署路径

### 2.A 推荐：SSH 路径（有 SSH key）
直接交给脚本，全自动：

```bash
REMOTE_HOST=124.221.146.145 \
REMOTE_USER=ubuntu \
REMOTE_DIR=/opt/service/openbuddy \
EXPECTED_VERSION=$(git rev-parse --short=12 HEAD) \
DEPLOY_APPLY=1 \
  bash scripts/install-new-api-worker-remote.sh
```

脚本会：
1. 在本地构建 release bundle
2. scp 到生产主机的 `/opt/service/openbuddy-incoming/`
3. 备份上一版镜像（`/opt/service/openbuddy/.previous-deploy/`）
4. 重启 Gateway 容器
5. 重新链接 4 个 systemd timer
6. 在 `/opt/service/openbuddy/scripts/` 下放置 worker 脚本

### 2.B 备选：仅 scp 上传，无 SSH 自动部署

如果生产主机禁止 SSH 执行命令，但允许 scp 上传：

```bash
# Step 1: 上传 tarball + 校验文件
scp /tmp/openbuddy-release/openbuddy-release-*.tar.gz \
    ubuntu@124.221.146.145:/opt/service/openbuddy-incoming/

# Step 2: 在生产主机上手动操作
ssh ubuntu@124.221.146.145
cd /opt/service/openbuddy-incoming
tar -xzf openbuddy-release-*.tar.gz
cd openbuddy-release-*/
# 按照 deployment-guide.md §3 执行手工部署
```

## 3. 部署后只读校验（关键门禁）

无论走哪条路径，部署完成后都必须跑：

```bash
# 3.1 版本字段必须等于 EXPECTED_VERSION
REMOTE_HOST=124.221.146.145 \
REMOTE_USER=ubuntu \
REMOTE_DIR=/opt/service/openbuddy \
EXPECTED_VERSION=$(git rev-parse --short=12 HEAD) \
  bash scripts/verify-remote-install.sh

# 3.2 生产自检：路由 + 真实 New API + Gateway /healthz + Prometheus + §9 HMAC
GATEWAY=http://124.221.146.145:8787 \
ADMIN_TOKEN="<production admin token>" \
CREDIT_EXPIRY_SECRET="<production 32-char secret>" \
NEW_API=http://124.221.146.145:3000 \
NEW_API_TOKEN="<production admin token>" \
CREDIT_EXPIRY_TENANTS="built-in,alice-corp,..." \
CREDIT_EXPIRY_RUN_ID="publish-check-$(date +%s)-$$" \
  bash scripts/deploy-doctor.sh

# 3.3 真实 New API capability snapshot（确认 quota_per_unit=500000 与本仓一致）
NEW_API_BASE_URL=http://124.221.146.145:3000 \
NEW_API_ADMIN_ACCESS_TOKEN="<production admin token>" \
NEW_API_ADMIN_USER_ID=1 \
NEW_API_CAPABILITY_SNAPSHOT_OUTPUT=/var/lib/openbuddy/capabilities.json \
  node scripts/new-api-capability-snapshot.mjs
```

任意一条 FAIL 都必须立刻停止发布并回滚。

## 4. 回滚路径

```bash
REMOTE_HOST=124.221.146.145 \
REMOTE_USER=ubuntu \
REMOTE_DIR=/opt/service/openbuddy \
DEPLOY_ROLLBACK=1 \
  bash scripts/install-new-api-worker-remote.sh
```

回滚会：
1. 把 Gateway 容器镜像切到上一份
2. 重新链接上一版的 systemd timer
3. 不删 worker 输出文件（避免覆盖当日商业对账）

回滚完成后用 §3.1 重跑版本校验，必须看到 `version=<上一个 tag>`。如果上一个 tag 不存在，则直接 `git checkout main && bash scripts/install-new-api-worker-remote.sh`。

## 5. 验收

部署成功的标志是下面 5 条全过：

- [ ] `git ls-remote origin refs/heads/codex/casdoor` → `<your codex/casdoor short sha>*`
- [ ] `release bundle` 在 `/tmp/openbuddy-release/` 存在且 SHA256 校验通过
- [ ] 生产 `/healthz` 返回 `version=$(git rev-parse --short=12 HEAD)`
- [ ] `scripts/verify-remote-install.sh` 退出码 0
- [ ] `scripts/deploy-doctor.sh` 9 个分段中 PASS+SKIP=9（FAIL=0）

任意一条不通过，本版本不得宣告发布成功。

## 6. 之后（可选）

- 在 GitHub Web 端为本次发布按 `## v0.15.0（2026-08-31）` 自动生成的 Release Notes 复核
- 通知订阅方：`docs/openbuddy-commercial-model.md` 列出的 3 个 active SKU 已完成端到端打通，可以开始计费
- 启动下一轮：把 §9 §10（多租户 SLA / 积分转赠 / SIEM 对接）等尚未实现的商业化能力列入 v0.16.0 backlog

## 7. 用 SSH 密码（非密钥）部署（2026-08-31 已验证）

如果操作员只有 `ubuntu` 账号密码（无 SSH key），且该用户在 `sudoers`（默认 Ubuntu 镜像），可使用 `scripts/deploy-with-password.sh`：

```bash
git checkout codex/casdoor && git pull --ff-only
bash scripts/build-release-bundle.sh /tmp/openbuddy-release
REMOTE_HOST=124.221.146.145 \
REMOTE_USER=ubuntu \
REMOTE_PASSWORD='qaz123ASD' \
EXPECTED_VERSION=$(git rev-parse --short=12 HEAD) \
  bash scripts/deploy-with-password.sh
```

脚本会：
1. `scp` 离线 bundle 到 `/tmp/openbuddy-release.tar.gz`
2. SSH 进 ubuntu，sudo 到 root
3. 在服务目录下重新生成 src tarball（包含 8 个 .ts 生产文件 + package.json + tsconfig.json）
4. 把 src 文件覆盖到 `/opt/service/openbuddy/services/casdoor-resource-gateway/`
5. `docker rmi -f openbuddy-resource-gateway:latest` 清掉旧镜像缓存
6. `docker build --no-cache` 在 gateway 子目录里重建（正确 build context）
7. `docker compose ... up -d --force-recreate --no-deps resource-gateway`
8. 等待 /healthz 上报 `EXPECTED_VERSION`

**已知坑**：build context 必须用 `services/casdoor-resource-gateway/` 子目录，而不是仓库根目录，否则 Dockerfile 的 `COPY package.json tsconfig.json ./` 会拿到根仓库的 package.json，编译出不含新路由的 dist/index.js。

**今日已验证**：`8926d4e7f7c2` 在 `124.221.146.145:8787` 上线，`/healthz.version=8926d4e7f7c2`，`/internal/v1/credits/expire` 返回 `503 CREDIT_EXPIRY_WORKER_DISABLED`（生产 `.env.remote-dev` 没配 `RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET`，符合预期）。
