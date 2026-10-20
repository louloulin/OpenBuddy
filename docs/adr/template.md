# ADR-NNNN: <决策标题>

- **Status**: Proposed | Accepted | Superseded by ADR-XXXX | Deprecated
- **Date**: YYYY-MM-DD
- **Deciders**: <主要决策人 / 团队>
- **Related**: <相关文件 / ADR / Issue 链接>

## Context / 背景

描述促使决策产生的张力:
- 现状是什么?
- 有什么问题或机会?
- 决策的时间窗 / 触发事件?
- 受影响的范围(包 / 模块 / 团队)?

## Decision / 决策

**明确的决策**:用什么、不用什么。

### 1. 主要选择

代码 / 配置 / 流程示例:
\`\`\`ts
// 代码片段
\`\`\`

### 2. 为什么选这个(权重 / 决策矩阵)

| 维度 | 候选 A | 候选 B | 候选 C |
|---|---|---|---|
| 性能 | ... | ... | ... |
| 维护成本 | ... | ... | ... |
| 生态 | ... | ... | ... |
| **加权总分** | **...** | **...** | **...** |

### 3. 实施细则

- 步骤 1
- 步骤 2
- 步骤 3

## Consequences / 影响

### 正面
- ...

### 负面
- ...

### 中性
- ...

## Alternatives Considered / 替代方案

### A. <方案名>
**理由反对**:...
**结论**:...

### B. <方案名>
**理由反对**:...
**结论**:...

## Verification / 验证

- ✅ 测试 1 通过(引用 \`path/to/test\` 测试名)
- ✅ 测试 2 通过
- ✅ 文档站链接更新
- ✅ 相关 PR 合入

## References / 参考

- PI-Desktop 同款决策:`path/to/PI-Desktop/ADR`
- 相关 RFC / Issue:`https://github.com/...`
- 上下游模块:`packages/...`、`crates/...`
