# OpenBuddy 积分转赠（Credit Transfer）

`POST /v1/tenants/{tenantId}/credits/transfer` 在同一租户内对个人账户与共享钱包做**原子积分转账**，用于：

- 团队管理员把个人购买额补到共享钱包；
- 同事之间相互赠送/归还积分；
- 共享钱包 owner 把余额提回到个人账户做退款/退还。

## 1. 接口定义

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `amount` | ✅ | 整数积分，最小 1，最大 1,000,000,000 |
| `idempotencyKey` | ✅ | 8–160 位 `[a-zA-Z0-9_.:-]`，跨重试安全 |
| `reason` | ❌ | 240 字符内的备注，写入两条 ledger 的 `reason` |
| `source` | ✅ | 必填其一：`{ subject }` 个人账户 **或** `{ walletId }` 共享钱包 |
| `destination` | ✅ | 必填其一：`{ subject }` 个人账户 **或** `{ walletId }` 共享钱包 |

源/目标不能指向同一账户；不能同时给同一侧传 `subject` 与 `walletId`；二者必须属于当前租户。

## 2. 权限矩阵

| 源侧 | 谁能发起 |
| --- | --- |
| 个人账户 (`source.subject`) | 仅本人（`identity.subject` 匹配）或租户/全局管理员 |
| 共享钱包 (`source.walletId`) | 该钱包 `owner` 成员或租户/全局管理员（由 `assertWalletAccess` 强制） |

| 目标侧 | 谁能接收 |
| --- | --- |
| 个人账户 (`destination.subject`) | 任意租户成员都能向他人账户转账（接收本身是积分赠予语义，不构成安全风险） |
| 共享钱包 (`destination.walletId`) | 该钱包 `owner` 成员或租户/全局管理员 |

错误码：`INVALID_TRANSFER_SOURCE` / `INVALID_TRANSFER_DESTINATION` / `TRANSFER_SAME_ACCOUNT` / `INVALID_CREDIT_AMOUNT` / `INVALID_CREDIT_IDEMPOTENCY_KEY` / `INSUFFICIENT_CREDITS` / `WALLET_ROLE_INSUFFICIENT` / `TRANSFER_IDEMPOTENCY_CONFLICT`。

## 3. 账本与幂等

- 同一 `idempotencyKey` 会在源/目标两侧分别写入 `idempotencyKey=transfer:<key>:out` 与 `:in`，类型均为 `adjustment`，`amount` 等于转账金额，`pointsSettled` 一侧为负、一侧为正。
- 两条流水通过 `sourceLedgerId` 互链（`outEntry.sourceLedgerId = inEntry.id`，`inEntry.sourceLedgerId = outEntry.id`），方便审计与对账。
- 账户字段：源侧 `balance -= amount`、`lifetimeConsumed += amount`；目标侧 `balance += amount`、`lifetimeGranted += amount`；两侧 `reserved` 不变。
- 幂等：相同 key 命中已有两条流水时返回 `replay: true` 与原 `outEntryId` / `inEntryId`；仅命中其中一条时返回 `409 TRANSFER_IDEMPOTENCY_CONFLICT`（部分重放视为脏状态，必须拒绝）。
- 写入遵循 `appendCreditLedgerEntry` 的 SHA-256 哈希链约束；`GET /v1/tenants/{tid}/credits/integrity` 仍然把转账视为普通 ledger 一部分。

## 4. 响应（201 / 200）

```json
{
  "data": {
    "amount": 250,
    "idempotencyKey": "transfer-personal-001",
    "source": { "balance": 750, "reserved": 0, "available": 750, "lifetimeConsumed": 250 },
    "destination": { "balance": 250, "reserved": 0, "available": 250, "lifetimeGranted": 250 },
    "outEntryId": "...",
    "inEntryId": "...",
    "replay": false
  }
}
```

`replay=true` 时返回 `200`；新创建返回 `201`。

## 5. 与其它商业化接口的关系

- **不替代** `grant`（管理员发放）或 `billing/orders` + `billing/callback`（支付购买积分）—— transfer 只在已有余额之间搬运，不写 `orderId`/`paymentId`。
- **不替代** `refund`（订单退款）—— refund 会同时冲销 `BillingOrder` 与 `lifetimeRefunded`，而 transfer 保持订单财务历史不变。
- **不改变** 共享钱包成员矩阵或租户策略；转账只搬运积分，不携带模型白名单、每日预算或 `newApiGroup` 权益。

## 6. 回归覆盖

`services/casdoor-resource-gateway/src/index.test.ts` 新增 3 个测试：

1. `transfers points between personal accounts, supports idempotent replay, and rejects non-owner/non-admin actors` —— 个人→个人、source-only check、idempotent replay、ledger 互链、超额拒绝。
2. `moves points between a personal account and a shared wallet only when caller is wallet owner or admin` —— 个人→钱包、钱包→个人、spender 不能扣钱包、spender 不能扣他人个人账户。
3. `rejects self-transfer, malformed source/destination, and conflicting idempotency keys` —— 参数校验矩阵。

