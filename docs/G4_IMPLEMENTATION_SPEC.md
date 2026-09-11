# G4 实现规格：pi-bridge 14 通道充分利用

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase D + backlog G4
>
> 本文档是 **Phase D 主项**，把 14 个 pi-bridge IPC 通道中**13 个死通道**逐一接入 renderer。
>
> **状态**：规格已落地（2026-09-11 Round 8）。代码改动需 dev-env + 真实 renderer 调用栈。
> **关联 audit**：`scripts/audit/pi-bridge-dead-channels.sh`（Round 4 第 3 个 audit）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前 IPC 通道 | 14（实测来自 `electron/main/agent/pi-bridge/index.ts:36-121`）|
| 已覆盖 | 1（仅 `parse-frontmatter`，被 `src/lib/agent/pi-client.ts:1460` 用）|
| 死通道 | 13 |
| 利用率 | 7%（GA gate: `≥ 80%`，差距 -73 pp）|
| 目标 | ≥ 12 通道被 renderer 真实消费（≥ 85%）|
| Owner | renderer team |
| 估时 | 2 周 |
| 阻塞 | 需 dev-env + 真实 renderer 集成测试 |
| 风险等级 | 中（IPC schema 变化会破坏现有 renderer）|

---

## 1. 当前实现盘点（pi-bbridge/index.ts）

来源：`grep -n "pi-bridge-" electron/main/agent/pi-bridge/index.ts`

**14 个 IPC 通道**（按域分类）：

| 域 | 通道 | 底层 pi 函数 | renderer 消费者 |
|---|---|---|---|
| text | `parse-frontmatter` | parseFrontmatter | ✅ `src/lib/agent/pi-client.ts:1460` |
| text | `strip-frontmatter` | stripFrontmatter | ❌ dead |
| text | `truncate-head` | truncateHead | ❌ dead |
| text | `truncate-tail` | truncateTail | ❌ dead |
| text | `truncate-line` | truncateLine | ❌ dead |
| text | `generate-diff` | generateDiffString | ❌ dead |
| text | `generate-patch` | generateUnifiedPatch | ❌ dead |
| image | `detect-mime` | (mime detection) | ❌ dead |
| image | `resize` | (image resize) | ❌ dead |
| image | `resize-file` | (file resize) | ❌ dead |
| image | `convert-to-png` | (PNG convert) | ❌ dead |
| skills | `load` | loadSkills | ❌ dead |
| skills | `load-from-dir` | loadSkillsFromDir | ❌ dead |
| skills | `format-for-prompt` | formatSkillsForPrompt | ❌ dead |

## 2. 目标：13 个死通道 → 12 个 renderer 消费者

**最低目标**：12/14 = 86%（≥ 80% GA gate 满足）。

**G4.x PR 拆分**（每条 1 个 PR，每 PR 1 通道 + 1 renderer 接入）：

### G4.1 `bridge.text.stripFrontmatter` → `plugin-sdk/src/manifest.ts`（依赖 G11）
- 替换自实现 YAML 解析
- PR scope：1 IPC 通道 + 1 renderer consumer

### G4.2 `bridge.text.truncateHead/Tail` → `MessageList.tsx` + `attachment/preview.ts`
- 长文件 / 长消息预览
- PR scope：2 IPC 通道 + 2 renderer consumer

### G4.3 `bridge.text.truncateLine` → `attachment/preview.ts`
- 单行截断（用于 diff 显示）
- PR scope：1 IPC 通道 + 1 renderer consumer

### G4.4 `bridge.text.generateDiff` → `ToolCallCard.tsx` + `DiffView.tsx`
- apply_patch / edit tool 的 diff 可视化
- PR scope：1 IPC 通道 + 2 renderer consumer

### G4.5 `bridge.text.generatePatch` → `ToolCallCard.tsx`
- apply_patch preview 生成
- PR scope：1 IPC 通道 + 1 renderer consumer

### G4.6 `bridge.image.detectMime` → `attachment/upload.ts`
- paste image MIME 自动检测
- PR scope：1 IPC 通道 + 1 renderer consumer

### G4.7 `bridge.image.resize/resize-file/convertToPng` → `attachment/upload.ts`
- image 上传前的尺寸/格式归一化
- PR scope：3 IPC 通道 + 1 renderer consumer

### G4.8 `bridge.skills.load/loadFromDir/formatForPrompt` → `plugin-host/src/skills.ts`
- renderer 端 skills 列表渲染
- PR scope：3 IPC 通道 + 1 renderer consumer（合并）

## 3. 迁移步骤（每条 1 PR，共 8 PR）

每 PR 标准步骤：
1. **PR-N.1**：在 `src/lib/agent/pi-client.ts`（或对应 renderer 文件）加 `bridge.<domain>.<verb>` 调用方法
2. **PR-N.2**：在 IPC handler 端（如需要）增加 typed schema + 错误码
3. **PR-N.3**：在 vitest 加 IPC round-trip 测试（mock ipcMain + 真实调用）
4. **PR-N.4**：跑 `bash scripts/audit/pi-bridge-dead-channels.sh --json | jq '.utilizationPct'` — 期望 +7pp（1/14 → 2/14）

## 4. 测试策略

| 测试类型 | 文件 | 数量 |
|---|---|---|
| 单元（PR-N）| `pi-client.test.ts` + 对应 consumer 测试 | 8-16 |
| 集成（最终）| `tests/electron/agent-workbench-core.spec.ts` | +1 case |
| Performance | `tests/electron/perf-streaming-burst.spec.ts` | IPC 延迟不变 |

**测试目标**：每 PR 后跑 IPC round-trip 测试通过；8 PR 完成后 utilizationPct ≥ 86%。

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 IPC schema 变化破坏 renderer | renderer 调用全错 | PR-N.2 schema 升级 | typed schema + 双向兼容 |
| R2 现有 renderer 调用栈迁移成本 | 工期 +1 周 | 现有自定义 YAML / diff 解析深 | 渐进迁移，保留 1 周双轨 |
| R3 image 处理性能 | 大图 resize 卡顿 | convertToPng 同步阻塞 | 改异步 + worker |
| R4 skills IPC 跨进程开销 | renderer 端 skills 列表加载慢 | skills 频繁调用 | 加 LRU cache |
| R5 pi 0.86.x 升级改 bridge 协议 | 14 通道全破 | pi 升级 | 协议版本号 + 兼容层 |

## 6. 验收命令（自动）

```bash
# 1. 静态 audit
bash scripts/audit/pi-bridge-dead-channels.sh --json | jq '.utilizationPct >= 80'   # true

# 2. 每 PR 后 utilizationPct 应该 +7pp (1/14 → 2/14)
bash scripts/audit/pi-bridge-dead-channels.sh --json | jq '.covered'   # 1 → 2 → 3 → ... → 12

# 3. 集成测试
pnpm test:electron:agent-workbench-core   # 全过
pnpm test:electron:provider-test-ipc      # IPC schema 兼容

# 4. GA gate
bash scripts/audit/pi-bridge-dead-channels.sh --json | jq '.gaOk'   # true
```

## 7. 与其他 G-gap 关系

- **依赖 G11**（plugin manifest 切 pi parseFrontmatter）：G4.1 是 G11 的 renderer 端入口；G11 必须先在 renderer 跑通。
- **解锁 G1**（apply-patch）：apply_patch 工具的 preview 在 renderer 端显示需要 G4.4 / G4.5 IPC。
- **解锁 G8**（29 canonical e2e）：renderer 端 skills 加载（G4.8）是 29 个 pi 包 e2e 的入口。

## 8. 进度更新

实施完成时：
1. `plan4.1.md §3 Phase D` 状态：`⬜ → 🟡 → ✅`
2. `docs/PI_INTEGRATION_BACKLOG.md §1 G4` 状态：`⬜ → 🟡 → ✅`
3. `docs/PI_NATIVE_AUDIT_BASELINE.md §0` GA gate 行：`pi-bridge 利用率 ❌ → ✅`
4. `scripts/audit/pi-bridge-dead-channels.sh` 的 utilizationPct 自动反映
5. 本规格 §0 状态：`规格已落地 → 实施完成 → 合并`