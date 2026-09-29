# OpenBuddy Architecture Decision Records (ADR)

决策记录库。每一篇 ADR 记录一次不可逆或高成本的架构决策,
以及决策时的 Context / Considered Alternatives / Consequences,
让后来人能溯源「为什么是这样而不是那样」。

## 索引

| 编号 | 标题 | 状态 | 阶段 |
|---|---|---|---|
| [ADR-0011](0011-plugin-page-simplification.md) | 插件页面简化 — MarketplacePanel 单一事实来源 / R97 | Accepted | R97 |
| [ADR-0012](0012-audit-log-ts-compatible-alignment.md) | 审计日志 Schema 对齐 — Rust ↔ TS 双向契约 / S5 | Accepted | S5 |
| [ADR-0013](0013-rust-ci-matrix.md) | Rust 8-triple CI 矩阵 + 跨平台构建 / S1 | Accepted | S1
| [ADR-0014](0014-p3-packaging-matrix.md) | P3 打包发布 — host-core binary 注入 + 跨平台构建矩阵 / S5 | Accepted | S5 |

> **新增 ADR 流程**:
> 1. 复制 [template.md](template.md) 为 `NNNN-kebab-case-title.md`
>    (NNNN = 下一个序号,4 位补零)。
> 2. 填写 Context / Decision / Consequences / Alternatives / Verification
>    / References 六段;中英双语可分两篇(如本目录 ADR-0011 / ADR-0012 / ADR-0013 均中英双语混合)。
> 3. 提交 PR 时在 PR 描述里链接 ADR 编号。
> 4. PR 合入后, ADR 状态从 Proposed → Accepted。
>
> **基线规则**(参考 `scripts/__tests__/ui-slot-coverage.test.mjs`):
> 槽位审计 / 跨平台 CI 等基线值在 R 阶段的 ADR 里显式登记,任何下调
> 必须在 PR 描述里说明 R 编号 + 原因(参考 ADR-0011 注释)。

## 历史 ADR

参考 PI-Desktop `crates/host-core` 与 pi-coding-agent 借鉴计划沉淀,
早期 OpenBuddy 决策散落在 `docs/architecture/`、`docs/adr/`(本仓库外的
fork)、`docs/agent-host-*.md`、`admin-console-architecture-decision.md`。
本目录从 R97 起作为 OpenBuddy 主仓库的事实 ADR 仓库,新决策必入此目录。
