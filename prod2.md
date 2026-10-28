# OpenBuddy 生产路线第二阶段（prod2）

> **日期**：2026-10-20 　**基线**：`main` @ `2438a2ab`（PR #64 已合并：prod1 P0/P1 全量落地）
> **前序**：`prod1.md`（P0 生产加固 ✅、P1 首批 ✅、核心功能真机就绪 17/1/0）
> **本文定位**：prod1 的直接后续 —— 收完 P1 尾巴、启动 P2 对标增值批次，并完成 v0.16.0 的发布收尾。
> ⚠️ **本文批次 B/C 已由 `plan1029.md` 冻结（作废）**。只保留批次 A 中与"发出第一个版本"直接相关的部分；其余功能扩展一律等 P3 决策门（真实下载数据）之后再谈。

---

## 0. 起点状态（接 prod1 进度快照）

| 项 | 状态 |
|---|---|
| P0 能发布 | 95% —— 仅剩人工项：mac 签名 secrets、Windows 证书、推 tag 首发演练 |
| P1 不被骂 | ~55% —— P1.1 95% / P1.2 100% / P1.3 真 PTY 0% / P1.4 35% / P1.5 60% |
| P2 对标增值 | 0% —— 本阶段启动第一批 |
| 核心功能真机 | 17 通过 / 1 跳过 / 0 失败（本机 Ollama 真实模型端到端）；"收到模型回复"待有余额 key 复跑 |

**本阶段的两个第一优先**：
1. **v0.16.0 发布收尾**（人工项，见 §2 批次 A）—— 代码已就绪，不要再往发布分支塞功能；
2. **真 PTY**（A1）—— 用户感知最强的一处"半残"，且阻塞"Agent 在终端里干活"的完整故事。

---

## 1. 输入与对齐

- **WorkBuddy 5.8.2**（本机实测，`app.asar.unpacked/cli/product.json`）：工具 62、productFeatures 126、A2A 四件套、AudioTranscribe、autoModeClassifier、SkillSecurityScan、outputStyles、CLI 命令面。对齐机会按性价比见 §3 批次 C。
- **prod1.md 遗留**：P1.3/P1.4/P1.5 未完成项 + 发布收尾人工项。
- **生产评审（10-11）未清的 MEDIUM**：redactText 语义（P1.2 已修）、附件清理（已修）、崩溃目录上限（已修）、WAL 上限（已修）；剩 `data:reset` UI 入口与降级提示横幅在批次 A。

---

## 2. 批次计划

### 批次 A —— v0.16.0 发布收尾 + P1 清零（预计 1.5–2 周）

| # | 任务 | 落点 | 验收 | 预估 |
|---|---|---|---|---|
| A1 | **终端真 PTY**：引入 node-pty 原生依赖（electron-builder `asarUnpack` + 重建脚本），替换 spawn 管道；IPC 形状不变 | `terminal-panel.ts`、`electron-builder.yml`、`package.json` | 真机跑 vim/htop 不退化；`process.stdout.isTTY === true`；三平台 CI 打包通过 | 3–4 天 |
| A2 | **数据管理收尾**：设置页「重置数据」入口（隔离现有库 → 重建空库，复用 P0.8 隔离逻辑）；迁移前自动备份（`driver.backup()` → `backups/auto-<版本>/`，保留最近 3 份）；降级横幅（`DowngradeBlockedError` → 用户可见提示） | `SettingsSections.tsx` 数据管理区、`session-metadata-store.ts`、`open-storage.ts` | 人为把 user_version 抬高 → 横幅提示且不砖；重置入口一键回到干净态 | 2–3 天 |
| A3 | **死面清理**：111 条零调用通道清单化。规则：注册但零 UI 调用 AND 零内部调用 → 删 handler 或降级为显式 `stub`；每删 10 条跑一次全量冒烟 | `misc.ts` 残留、`ipc-stub-baseline.json` | `verify:ipc-stubs` 新增"零调用通道"计数归零或全部登记 | 2–3 天 |
| A4 | **门禁转正**：`pnpm audit --prod` 转硬门禁（当前绿）；lint-tools 建**警告基线文件**（当前 12,413 条逐文件计数），新增告警即红、存量按棘轮消化 | `ci.yml`、新 `scripts/check-lint-baseline.mjs` | 故意加一条 eslint 告警/一个高危依赖 → CI 红 | 1–2 天 |
| A5 | **v0.16.0 首发**（人工 + 代码各半）：secrets 配置 → 推 tag → draft Release → 三平台真机安装 → 官网下载链接指真实 tag → **用有余额的 key 复跑 `core-release-readiness.mjs` 确认 J2b/J3** | `release.yml`、`apps/openbuddy-website` | §5 checklist 全勾；安装包在干净机器可装可升 | 2–3 天（含等待） |

**A 批出口标准**：CI 全绿 + v0.16.0 Release 发布 + 官网可下载 + P1 全项 ✅。

### 批次 B —— 生成能力（P2 首批，预计 2 周）

| # | 任务 | 对标 | 路线 | 落点 | 验收 | 预估 |
|---|---|---|---|---|---|---|
| B1 | **Office 文档生成**：`openbuddy_docs_generate`（docx/pptx/xlsx 三工具，参数=大纲/模板→产物路径）| WB §2.9（docx + pptxgenjs 同构）| 新 capability 包 `openbuddy-capability-docs`（依赖 docx/pptxgenjs/exceljs）+ pi-extensions 适配器 + 富预览已有落点直接看产物 | 对话中"生成一份 PPT"→ 产物出现在产物中心并可预览 | 5–7 天 |
| B2 | **HTML→图片海报**：puppeteer 截图服务（B1 的 PPT 路线复用）| WB poster | 依赖受管 Chrome（见 B5）或系统 Chrome | 同上 | 3 天 |
| B3 | **图像生成**：ImageGen 工具，provider 抽象（OpenAI images API + 用户自配 key）| WB ImageGen | `openbuddy-capability-imagegen`，BYOK 模式 | 对话中生成图片并落入产物中心 | 3–4 天 |
| B4 | **语音转写兜底**：WebSpeech 不可用平台回落用户自配 STT（OpenAI audio API）| WB AudioTranscribe | `voice-recognition.ts` 加 provider 分支 | mac/win 都能语音输入 | 3 天 |

### 批次 C —— 系统与集成（P2 续，预计 3 周）

| # | 任务 | 对标 | 路线 | 预估 |
|---|---|---|---|---|
| C1 | **托盘 + 全局快捷键 + 剪贴板图片** | WB §2.11 | Electron Tray/globalShortcut，纯主进程；快捷键编辑器接设置页 | 3–5 天 |
| C2 | **沙箱策略 + 命令安全审计**：`apply_command` 从 `/bin/sh -c` 改走规则驱动沙箱（mac sandbox-exec 起步）+ 命令哈希审计链（复用 audit-log）| WB sandbox-cli/audit-log（453 条实证）| 新 `openbuddy-sandbox` 包 + policy 规则文件 | 1–2 周 |
| C3 | **MCP Apps 宿主**：MCP 提供的 UI 沙箱渲染 | WB `mcp-app-preload.js` | 复用 CanvasSandboxFrame 的 data: URL 隔离经验 | 1 周 |
| C4 | **autoMode**：LLM 分级工具风险自动放行（只读自动、写操作问、危险必问）| WB autoModeClassifier | 平移到 modeGate：分级器子代理 + 白名单缓存 + 审计 | 4–6 天 |
| C5 | **受管运行时**：启动时按平台下载受管 Node（哈希校验），供技能脚本使用 | WB 自带 Node 22 | storage paths + 下载器 + 版本清单 | 1 周 |
| C6 | **技能增强**：批量更新/启停 + SkillSecurityScan（哈希 + 禁用模式匹配）+ skill-creator | WB SkillManage | 复用 marketplace 与 plugin-security | 1 周 |
| C7 | **A2A 出站**：向外部 A2A agent 发任务并跟踪 | WB A2A 四件套 | collaboration 已有 A2A 卡片/联邦，补出站发送器 + 任务状态轮询 | 4–6 天 |
| C8 | 语音转写服务端兜底已并入 B4；A2A 入站已有 | — | — | — |

### 批次 D —— 明确不做 / 延后（维持 prod1 §P3）

- ✖ 腾讯云模型/额度、腾讯生态内容源、国内 IM 渠道本体、云发布、远程市场 CDN
- ⏸ IDE 内联补全层（NES/InlineChat/CodeLens/VS Code 扩展宿主）—— 等 C 批完成后重估
- ⏸ Colleagues 可雇佣 AI 同事、专家团队市场目录

---

## 3. 里程碑

```
M1（第 1 周末）  批次 A 完成 → v0.16.0 Release 发布 + 官网上线
M2（第 3 周末）  批次 B 完成（Office 生成 + 图像生成可用）
M3（第 6 周末）  批次 C 完成 → 对标 WB 5.8.2 的系统层能力补齐
之后             IDE 层重估；进入下一条产品线（生成质量/多智能体深化）
```

依赖关系：A5 不阻塞 B/C（B/C 在 develop 分支滚动）；B1 的完整体验依赖 C5（受管 Node），可先用用户本机 Node 降级交付。

---

## 4. 出口标准

**prod2 完成时**，对标 WB 5.8.2 的能力面：

| WB 能力域 | prod1 后 | prod2 后 |
|---|---|---|
| 对话/工具/审批/rewind | ✅ | ✅ |
| 任务/计划/记忆/自动化/产物/终端/Git | ✅ | ✅（终端升真 PTY） |
| 语音输入 | ⚠️ | ✅（+STT 兜底） |
| Office 生成 | ⛔ | ✅ |
| 图像生成 | ⛔ | ✅ |
| 托盘/全局快捷键 | ⛔ | ✅ |
| 沙箱+命令审计 | ⛔ | ✅（mac 起步） |
| MCP Apps | ⛔ | ✅ |
| autoMode | ⛔ | ✅ |
| 受管运行时 | ⛔ | ✅ |
| 技能批量/安全扫描 | ⚠️ | ✅ |
| A2A 出站 | ⚠️ | ✅ |
| IDE 内联补全 | ⛔ | 延后（明确不做清单） |
| 腾讯生态/国内 IM | ✖ | 不做（维持） |

---

## 5. prod2 验收 checklist

```
[ ] node-pty 终端：vim/htop 可用，isTTY 正确，三平台打包通过
[ ] 设置页「重置数据」可用；迁移前自动备份保留最近 3 份
[ ] 降级库打开有横幅提示且不砖
[ ] 零调用通道清理完成或全部登记（verify:ipc-stubs 扩展计数）
[ ] audit --prod / lint 基线转为硬门禁；故意破坏即红
[ ] v0.16.0 Release 发布；官网下载指向真实 tag；三平台干净机器安装
[ ] 有余额 key 复跑 core-release-readiness → J2b/J3 转 PASS
[ ] Office 生成三工具端到端（对话→产物中心→预览）
[ ] 图像生成端到端（BYOK）
[ ] 托盘 + 全局快捷键 + 剪贴板图片可用
[ ] 沙箱：命令经规则文件放行/拒绝，审计链可查
[ ] MCP Apps：一个 MCP 应用在沙箱 iframe 中渲染
[ ] autoMode：只读操作自动放行、写操作弹窗（有审计）
[ ] 受管 Node 下载校验后可供技能脚本使用
[ ] A2A 出站：向外部 agent 发任务并收到状态
```

---

*本文为计划文档；实现按批次滚动，每批完成即在 §2 表格标记状态并更新 §4 对标表。*
