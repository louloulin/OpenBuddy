# AI Chat 真机端到端验证报告(R80)

> 📅 2026-09-17 · 真模型 MiniMax(M3 / M2.7)· 两条独立路径各 **10/10 轮通过**

本报告只记录**可复现的真机证据**。所有数字来自真实 Electron 进程 + 真实
MiniMax 上游,不 mock、不打桩。

## 1. 验证目标

用户诉求:「继续实现最核心的 AI Chat 改造,同时真的验证,10 轮对话真的验证,
配置真实的 MiniMax API key 验证」。

因此需要证明两件事:

1. **IPC 层**:`agent:prompt` → 上游 → `pi://update` 流式 chunk → `pi://complete`
   的完整链路由真实模型驱动时可跑通。
2. **UI 层**:用户在真实输入框打字 + 点真实「发送」按钮,`.msg--assistant`
   真的流式渲染出正文,且过程是**渐进**的(不是一次性塞入)。

## 2. 复现方式

```bash
# 凭证:任一来源(优先级从高到低)
#   1) 环境变量 OPENBUDDY_E2E_API_KEY / _BASE_URL / _MODEL_ID
#   2) 仓库根 .env.e2e.local(gitignore 的 *.local 规则)
#   3) ~/.openbuddy/agent/auth.json   (然后回落 ~/.pi/agent/auth.json)
cat > .env.e2e.local <<'ENV'
OPENBUDDY_E2E_API_KEY=<your-minimax-key>
OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic
OPENBUDDY_E2E_MODEL_ID=minimax/MiniMax-M3
ENV

# 路径 A:IPC 层 10 轮
node scripts/electron/_probe-r80-chat-10rounds.mjs

# 路径 B:真实 UI 10 轮
node scripts/electron/_probe-r80-ui-10rounds.mjs

# 或走 vitest(凭证缺失时自动 skip)
pnpm exec vitest run scripts/electron/_probe-r80-chat-10rounds.test.mjs
pnpm exec vitest run scripts/electron/_probe-r80-ui-10rounds.test.mjs
```

## 3. 真机事件契约(实现依据)

探针的订阅方式不是猜的,是读代码得出的:

| 事实 | 依据 |
|---|---|
| 流式 chunk 走 `pi://update`,payload 是 `SessionUpdate` | `src/lib/agent/pi-client.ts:2150` `dispatchPiEvent` |
| chunk 的 part 是 `text_delta`(不是 `text`) | `electron/main/agent/host-modules/bootstrap/handle-session-event.ts:325-331` |
| 高频通道走 MessagePort,批量形状 `{version:1, events:[...]}` | `electron/main/pi-stream-transport.ts` + `preload/index.ts:359` |
| 完成信号是 `pi://complete` + `PromptComplete.stopReason` | `handle-session-event.ts:485-492` |
| 上游失败走 `pi://turn-error`(不是 complete) | `handle-session-event.ts:536-545` |
| `agent:set-model` 需要 `provider/modelId` 全称 | `electron/main/agent/host-modules/agent-model.ts:79-84` |
| 必须真注册 provider,否则回落 `<agentHome>/auth.json`(默认 `~/.openbuddy/agent/auth.json`,再回落 `~/.pi/agent/auth.json`) | `scripts/lib/e2e-credentials.mjs` 头部注释 + `agent-model.ts` authStatus |

### 3.1 两个真实陷阱(踩过才写进来)

1. **不注册 provider 会拿到 429,而不是报错**。
   第一版探针把 key 放在环境变量里就发 prompt,结果拿到
   `429 rate_limit_error: 已达到 Token Plan 用量上限`(来自一个已耗尽的旧 key)。
   同一把 key 用 `curl` 直连上游是 **HTTP 200 + 正常内容**。
   结论:必须写空壳 `pi-agent/{models.json,auth.json}` + `PI_CODING_AGENT_DIR`
   + `agent:providers-save-provider` / `agents:providers-save-model`,
   并且 `scrubProviderCredentials()` 清掉环境里残留的 `ANTHROPIC_*` 等变量。

2. **`agent:set-model` 传裸模型名会被拒**。
   `MiniMax-M3` → `model MiniMax-M3 not found`;
   `minimax/MiniMax-M3` → 成功。因为 `setModel()` 会
   `modelId.split("/")` 再交给 `ModelRegistry.find(provider, model)`。

## 4. 结果

### 4.1 路径 A — IPC 层

```
ok = true | doneCount = 10/10
authStatus = { ready: true } | currentModel = { id: "MiniMax-M2.7", provider: "minimax" }
pageErrors = [] | consoleErrors = []

R00   1583ms stop=stop len= 16 | 'Hi! 你好，很高兴见到你！👋'
R01    956ms stop=stop len=  1 | '2'
R02   1270ms stop=stop len=  5 | 'Hello'
R03   1022ms stop=stop len=  8 | '苹果、香蕉、橙子'
R04   1366ms stop=stop len=  2 | '巴黎'
R05   1336ms stop=stop len=  3 | '120'
R06   2519ms stop=stop len=  9 | '\n祝你开心每一天！'
R07   1623ms stop=stop len=  2 | '东方'
R08   1204ms stop=stop len=  2 | '12'
R09   1322ms stop=stop len= 17 | '超文本传输协议，用于网络数据传输。'
```

切换 `OPENBUDDY_E2E_MODEL_ID=minimax/MiniMax-M3` 后同样 **10/10**,平均每轮
0.9–2.5s。

### 4.2 路径 B — 真实 UI

```
ok = true | doneCount = 10/10 | streamingRounds = 10/10
composerEnabled = true | authStatus = { ready: true }
pageErrors = [] | consoleErrors = []

R00   3250ms stop=stop turnDone=1 len= 6 | 'Hi! 👋'
R01   2790ms stop=stop turnDone=1 len= 1 | '2'
R02   1606ms stop=stop turnDone=1 len= 5 | 'Hello'
R03   1942ms stop=stop turnDone=1 len= 8 | '苹果、橙子、香蕉'
R04   2039ms stop=stop turnDone=1 len= 2 | '巴黎'
R05   1750ms stop=stop turnDone=1 len= 3 | '120'
R06   2085ms stop=stop turnDone=1 len= 4 | '早上好！'
R07   2192ms stop=stop turnDone=1 len= 2 | '东方'
R08   1890ms stop=stop turnDone=1 len= 2 | '12'
R09   1750ms stop=stop turnDone=1 len=22 | '超文本传输协议，用于在网络上传输网页和数据。'
```

每轮同时断言:

- `typedOk` — 输入框里的字符串与 prompt 完全一致(逐字 `type()`,触发 React onChange)
- `userEchoed` — 用户消息真的渲染进 `.msg--user .msg__bubble-text`
- `isStreaming` — 200ms 采样的 `.msg--assistant .msg__body` 里存在
  **「正文非空 且 `pi://complete` 尚未到达」** 的样本(证明是边生成边渲染)。
  这个判据与回答长度无关;先前用的"长度序列出现 ≥2 个不同值"对 `2` 这种
  单字符回答永远不成立(只有 `0 → 1` 一次跳变),会在串行 runner 里偶发假失败。
- `turnDone` — 等的是本轮的 `pi://complete`,而不是"长度不变"
  (reasoning 阶段的「深度思考」占位会短暂稳定,只看长度会把占位当正文)

## 5. 已知边界

- **`MiniMax-M3` 与 `MiniMax-M2.7` 均验证通过**;`-highspeed` 变体未单独跑。
- 推理(reasoning)内容以「深度思考」折叠头呈现,不计入正文长度;
  探针在断言前会剥掉该前缀。
- 本报告只覆盖**单会话连续 10 轮**;多会话 / 分叉 / 队列(steer/follow-up)
  的端到端验证由既有 e2e 覆盖(见 `docs/AI_CHAT_PLAN.md`)。

## 6. 回归守卫

| 文件 | 作用 | 凭证缺失时 |
|---|---|---|
| `scripts/electron/_probe-r80-chat-10rounds.mjs` | IPC 路径 10 轮真机探针 | 退出码 1 并打印 `no api key` |
| `scripts/electron/_probe-r80-ui-10rounds.mjs` | UI 路径 10 轮真机探针 | 同上 |
| `scripts/electron/_probe-r80-chat-10rounds.test.mjs` | vitest 包装(3 断言组) | `describe.skipIf` 跳过 |
| `scripts/electron/_probe-r80-ui-10rounds.test.mjs` | vitest 包装(3 断言组) | `describe.skipIf` 跳过 |
