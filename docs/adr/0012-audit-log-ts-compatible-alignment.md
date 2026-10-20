# ADR-0012: 审计日志 Schema 对齐 — Rust ↔ TS 双向契约 / S5

- **Status**: Accepted (R97/S5, 2026-09-24)
- **Deciders**: OpenBuddy maintainers
- **Related**:
  - Rust 实现:`crates/openbuddy-host-core/src/audit/mod.rs::AuditLogLine`
  - Rust 共享类型:`crates/openbuddy-audit-types/src/lib.rs::AuditEntry / AuditKind / AuditOutcome`
  - TS 接口:`packages/runtime/openbuddy-host-runtime/src/capabilities.ts::AuditEntry / AuditKind / AuditOutcome`
  - TS 测试:`packages/runtime/openbuddy-host-runtime/src/__tests__/capabilities.test.ts`
  - Rust 磁盘契约测试:`crates/openbuddy-host-core/src/audit/mod.rs::tests::on_disk_json_matches_ts_audit_event_contract`
  - TS 类型层契约测试:`packages/runtime/openbuddy-host-runtime/src/__tests__/capabilities.test.ts` 的 `wire shape 拒绝旧字段` 测试

## Context / 背景

OpenBuddy 审计日志走两段:

1. **写路径**:`renderer / main` → `host.call("audit.append", params)` →
   Rust `audit::AuditHandle::append` → 磁盘 `<data_dir>/audit.jsonl`。
2. **读路径**:`renderer` → `host.call("audit.tail", params)` →
   Rust `audit::AuditHandle::tail` → 返回 `entries: AuditLogLine[]` →
   renderer 解析显示。

这条 wire 在 R97 之前,TS / Rust 两侧的字段名不一致:

| 字段 | Rust 写入(旧 shape) | TS 读取(旧 shape) | 当前 wire shape(v1) |
|---|---|---|---|
| 事件名 | `action` | `action` | `event` |
| 类别 | 顶层 `kind: AuditKind` | 顶层 `kind: string` | `detail.kind: AuditKind` |
| 来源 | (无) | (无) | `source: "main"` |
| 结果哈希 | `payload_hash` | `payloadHash` | `hash` |
| 结果 outcome | `Success → "success"` | `"success"` | `Success → "success" / Failure → "failure" / Denied → "deny" / Timeout → "failure"` |
| 类别枚举 | `snake_case`(serde rename) | `"permission"` 等 | `snake_case`(同 Rust) |

旧 shape 直接给 main + renderer 用,renderer 自己读 `audit.jsonl` 时
拿到的字段(`action` / `payload_hash` / 顶层 `kind`)与 TS 接口
`AuditEntry` 不一致,导致:

- **renderer 解析失败**:Renderer 自己 grep `audit.jsonl` 文件时,
  拿不到 `event` 字段(只能拿到 `action`),所以 grep 工具的列名错乱。
- **审计导出工具错位**:CSV 导出脚本读 `action` / `payload_hash`,
  但 UI 显示用的是 `event` / `hash`,导致「同一条记录两套列名」。
- **类型层无保护**:`@ts-expect-error` 不能阻止 `AuditEntry.action` 的
  误用,因为旧 shape 还存在时 TS 推断失败。
- **磁盘 JSON 与 memory shape 不一致**:Rust 在内存里用 `AuditEntry`
  (`action` / `payload_hash`),写到磁盘用 `AuditLogLine`(`event` /
  `hash`),两套 serde derive,新人修改时容易漏改一处。

## Decision / 决策

S5 决定:**Rust ↔ TS 双向契约对齐**,所有路径(磁盘 / 内存 / wire)
都用同一套字段名(v1 shape),并增加双向契约测试。

### 1. Wire shape v1(权威定义)

```ts
// 磁盘 audit.jsonl 每行 + tail RPC 返回的 AuditEntry 都用这个 shape:
interface AuditEntry {
  id: string;                         // UUID v4
  at: string;                         // ISO-8601 UTC,from chrono::DateTime<Utc>
  event: string;                      // 例如 "bash.run" / "secrets.resolve"
  outcome: "success" | "failure" | "deny" | "info";
  source: "main" | "renderer" | ...;  // 当前 Rust 写入固定为 "main"
  subject?: string;                   // 操作主体(用户 ID / session ID / ...)
  detail: {
    kind: "auth" | "permission" | "folder_trust" | "tool"
        | "plugin" | "secret" | "host" | "other";
    tenant_id?: string;
    resource?: string;
    reason?: string;
    code?: string;                    // 错误码(SECRET_NOT_FOUND 等)
    provider?: string;                // 第三方服务(openai / casdoor / ...)
    target?: string;                  // 操作目标(secret ref / file path / ...)
  };
  hash: string;                       // SHA-256(前 12 字节 hex,24 字符)
}
```

### 2. append RPC 仍然是「写一条」的轻量返回

```ts
// audit.append 返回的是 AppendResult(id + at + payloadHash),
// 不是 AuditEntry — append 路径只是「写一条记录」,不返回完整 wire shape。
// 调用方拿 id / at / payloadHash 做引用 / 校验。
interface AuditAppendResult {
  id: string;
  at: string;
  payloadHash: string;
}

// append params 仍然是「写一条」的入参,字段聚合在 detail 内:
interface AuditAppendParams {
  kind: string;                       // auth | permission | folder_trust | tool | plugin | secret | host
  outcome: string;                    // success | failure | denied | timeout
  action: string;                     // 例如 "bash.run",落到 detail.action
  subject?: string;
  tenant_id?: string;
  resource?: string;
  reason?: string;
  code?: string;
  provider?: string;
  target?: string;
}
```

> 命名注:`payloadHash` 在 append result 保留(`AppendResult::payload_hash` →
> `#[serde(rename = "payloadHash")]`),与磁盘 `hash` 字段语义相同,但
> 路径不同 — append 是 RPC response,磁盘是 storage format。两者字段名
> 故意不一致,避免调用方误把 append 响应当作磁盘行用。

### 3. Rust 端 AuditLogLine / From<&AuditEntry>

```rust
// crates/openbuddy-host-core/src/audit/mod.rs
#[derive(Debug, Serialize, Deserialize)]
pub struct AuditLogLine {
    pub id: String,
    pub at: chrono::DateTime<Utc>,
    pub event: String,        // ← AuditEntry.action 重命名
    pub outcome: String,
    pub source: String,       // ← 新增,常量 "main"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub detail: AuditLogLineDetail,
    pub hash: String,         // ← AuditEntry.payload_hash 重命名
}

impl From<&AuditEntry> for AuditLogLine {
    fn from(entry: &AuditEntry) -> AuditLogLine {
        let outcome = match entry.outcome {
            AuditOutcome::Success => "success",
            AuditOutcome::Failure => "failure",
            AuditOutcome::Denied  => "deny",
            AuditOutcome::Timeout => "failure",
        };
        AuditLogLine {
            id: entry.id.clone(),
            at: entry.at,
            event: entry.action.clone(),   // ← 关键映射
            outcome: outcome.to_string(),
            source: "main".to_string(),   // ← 新增 source
            subject: entry.subject.clone(),
            detail: AuditLogLineDetail {
                kind: entry.kind,          // ← 顶层 kind 聚合到 detail
                tenant_id: entry.tenant_id.clone(),
                resource: entry.resource.clone(),
                reason: entry.reason.clone(),
                code: entry.code.clone(),
                provider: entry.provider.clone(),
                target: entry.target.clone(),
            },
            hash: entry.payload_hash.clone(),  // ← 关键映射
        }
    }
}
```

### 4. 双侧契约测试

#### 4.1 Rust 磁盘 JSON 契约(`on_disk_json_matches_ts_audit_event_contract`)

```rust
#[test]
fn on_disk_json_matches_ts_audit_event_contract() {
    let (handle, audit_path) = fixture_handle_with_path();
    handle.append(AppendParams {
        kind: "permission".into(),
        outcome: "denied".into(),
        action: "bash.run".into(),
        subject: Some("rm -rf /".into()),
        tenant_id: Some("acme".into()),
        resource: Some("/etc".into()),
        reason: Some("deny-rule-match".into()),
        code: Some("PERMISSION_DENIED".into()),
        ..Default::default()
    }).unwrap();

    let raw = std::fs::read_to_string(&audit_path).unwrap();
    let line = raw.lines().next().unwrap();
    let v: serde_json::Value = serde_json::from_str(line).unwrap();

    // 顶层 TS 字段必须存在
    for key in ["id", "at", "event", "outcome", "source", "detail", "hash"] {
        assert!(v.get(key).is_some(), "missing top-level field {key}");
    }
    // detail.kind 等聚合字段
    assert_eq!(v["detail"]["kind"], "permission");
    // 旧 Rust shape key 不能在顶层
    assert!(v.get("payload_hash").is_none());
    assert!(v.get("kind").is_none());
    assert!(v.get("action").is_none());
    // outcome 必须是 "deny" (Denied 映射),hash 必须是 24 hex chars
    assert_eq!(v["outcome"], "deny");
    assert_eq!(v["hash"].as_str().unwrap().len(), 24);
}
```

#### 4.2 TS 类型层契约(`wire shape 拒绝旧字段`)

```ts
// @ts-expect-error — AuditEntry has no top-level `action` field
const bad: AuditEntry = { id: "1", at: "t", action: "bash.run", ... };
// @ts-expect-error — `payloadHash` 字段名已废,改用 `hash`
const bad2: AuditEntry = { id: "1", at: "t", payloadHash: "h", ... };
// @ts-expect-error — `kind` 已聚合到 detail.kind
const bad3: AuditEntry = { id: "1", at: "t", kind: "permission", ... };
```

#### 4.3 TS 解析契约(`tail parses AuditEntry wire shape`)

```ts
it("tail parses AuditEntry wire shape (event / source / hash / detail)", async () => {
    const wireEntry = {
        id: "01HXYZW",
        at: "2026-09-23T01:00:00Z",
        event: "bash.run",
        outcome: "deny",
        source: "main",
        subject: "rm -rf /",
        detail: {
            kind: "permission",
            tenant_id: "acme",
            resource: "shell:bash",
            reason: "deny-rule-match",
            code: "PERMISSION_DENIED",
        },
        hash: "deadbeef0123456789abcdef",
    };
    const { host } = fakeHost({ "audit.tail": { entries: [wireEntry], rotatedFiles: 0 } });
    const res = await callAuditTail(host, { limit: 50 });
    expect(res.entries[0]).toEqual(wireEntry);
    expect(res.entries[0].detail.kind).toBe("permission");
    expect(res.entries[0].event).toBe("bash.run");
    expect(res.entries[0].source).toBe("main");
    expect(res.entries[0].hash).toBe("deadbeef0123456789abcdef");
    expect(res.entries[0].outcome).toBe("deny");
});
```

### 5. AuditKind / AuditOutcome 字符串对照表

#### 5.1 AuditKind(snake_case,Rust serde rename_all)

| Rust 枚举 | 序列化字符串 |
|---|---|
| `AuditKind::Auth` | `"auth"` |
| `AuditKind::Permission` | `"permission"` |
| `AuditKind::FolderTrust` | `"folder_trust"` |
| `AuditKind::Tool` | `"tool"` |
| `AuditKind::Plugin` | `"plugin"` |
| `AuditKind::Secret` | `"secret"` |
| `AuditKind::Host` | `"host"` |

TS 类型层:`type AuditKind = "auth" | "permission" | "folder_trust" | "tool" | "plugin" | "secret" | "host" | "other"`,`"other"` 留给 renderer-only 事件(进度 / 通知 / debug,不来自 host-core)。

#### 5.2 AuditOutcome(snake_case,Rust serde rename_all → Rust → TS 二次映射)

| Rust 枚举 | 中间态(AuditLogLine.outcome) | TS AuditOutcome |
|---|---|---|
| `AuditOutcome::Success` | `"success"` | `"success"` |
| `AuditOutcome::Failure` | `"failure"` | `"failure"` |
| `AuditOutcome::Denied` | `"deny"`(语义更明确) | `"deny"` |
| `AuditOutcome::Timeout` | `"failure"`(归并) | `"failure"` |

> 关键:`Denied → "deny"` 的映射让 renderer 的 deny / failure / success
> 三态清晰;`Timeout → "failure"` 归并避免 4 态判断分支爆炸。
> `AuditOutcome` TS 类型额外预留 `"info"` 给 renderer-only 软事件。

## Consequences / 影响

### 正面

- **磁盘 + 内存 + RPC wire 三者一致**:`AuditLogLine` 是这三处的
  唯一权威 serde 模型。Rust 内部用 `AuditEntry`(含 action / payload_hash),
  写盘 / 出 RPC 前都 `From<&AuditEntry> for AuditLogLine`,字段名
  映射一次到位。
- **类型层保护**:`@ts-expect-error` 注释 + `on_disk_json_matches_*`
  双测试。任何旧 shape 字段被引入,CI 立即失败。
- **Renderer 解析简化**:grep `audit.jsonl` 时,所有字段名都是 `event` /
  `hash` / `source`,与 UI 列名一致。
- **审计导出工具统一**:CSV 导出脚本读 `event` / `hash` 与 UI 显示
  字段一致,无 fork。

### 负面

- **append result 字段名(`payloadHash`)与磁盘字段名(`hash`)不一致**:
  这是刻意为之 — append RPC response 是「写一条」的轻量返回,
  磁盘行是 storage format。调用方拿 `payloadHash` 做引用即可,
  不应把它当作磁盘行用。
  文档 / JSDoc 必须明确这一点。
- **AuditKind::Denied → "deny",Timeout → "failure" 双重映射**:
  Rust AuditOutcome 与 AuditLogLine.outcome 是两个不同的 enum,
  任何新人修改必须改两处。建议在 `From<&AuditEntry>` 实现里加注释。
- **旧 shape 测试已被覆盖**:本次新增 2 个 wire format 测试(`@ts-expect-error`
  + `tail parses AuditEntry wire shape`),旧 `append` / `tail` 测试
  仍保留作为 sanity check。

### 中性

- `AuditEntry` / `AuditLogLine` 两个 struct 在 Rust 端共存,前者是
  RPC 入参 / AppendParams 派生,后者是序列化输出。两者 `kind` /
  `outcome` 字段共享同一 enum,只是 `action → event` 与
  `payload_hash → hash` 在序列化层映射。

## Verification / 验证

- ✅ Rust 端 3 个 audit 测试通过(invalid_kind_is_rejected / append_then_tail /
  on_disk_json_matches_ts_audit_event_contract)。
- ✅ TS 端 21 个 capabilities 测试通过(含 wire format 契约测试 + 旧 shape 测试)。
- ✅ `grep "AuditEntry\|AuditLogLine" crates/` 3 处引用一致(append /
  tail / From impl)。
- ✅ `grep "AuditEntry\|AuditLogLine" packages/runtime/openbuddy-host-runtime/src/`
  1 处引用(`capabilities.ts`)。

## Alternatives Considered / 替代方案

### A. Rust 端改用 AuditLogLine 作为唯一 struct

**理由反对**:AuditEntry(action / payload_hash)更贴近事件语义,
  AuditLogLine(event / hash)更贴近序列化语义。两者职责不同,
  强合并会让 RPC 入参也用 `event` 字段名,反而与 Rust 函数调用
  习惯(action 命名)冲突。
**结论**:保留 AuditEntry + AuditLogLine 双 struct,显式 `From` 映射。

### B. append result 字段名也改成 `hash`

**理由反对**:append result 是 RPC response,不是磁盘行。把它命名为
  `hash` 会让调用方误以为「拿到的就是磁盘行」,实际它只是「写一条
  的 id + at + 哈希引用」。
**结论**:保留 `payloadHash` 命名,在 JSDoc 明确「append result ≠
  AuditEntry」。

### C. AuditOutcome 不做 Denied → deny 映射,保留 snake_case

**理由反对**:renderer UI 用 deny / failure / success 三态语义。
  把 Denied 直接 serialize 成 `"denied"` 会让 renderer 也要做 4 态判断,
  多一层 mapping。
**结论**:保留 Denied → "deny" 映射,文档明确。

## References / 参考

- 旧 shape commit:3c02014 之前的版本(参考 `git log --diff-filter=D -- crates/openbuddy-host-core/src/audit/mod.rs`)。
- AuditKind serde rename_all 文档:`https://serde.rs/container-attrs.html#rename_all`
- chrono::DateTime<Utc> 序列化:`At` trait,默认 RFC 3339 ISO-8601。
