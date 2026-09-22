// packages/auth/openbuddy-casdoor/src/renderer/index.ts
//
// Tier 2 入口:ui-* 包只允许通过 `./renderer` 子路径访问 casdoor 的渲染层 API。
// 主入口 `./` 仍暴露 CasdoorLifecycleKind / auth service 等供 main 进程使用。
export {
  CASDOOR_RESOURCE_TYPES,
} from "../index";

export type {
  CasdoorResourceCreateInput,
  CasdoorResourceRecord,
  CasdoorResourceType,
  CasdoorLifecycleEvent,
  CasdoorLifecycleKind,
  CasdoorSessionBinding,
  CasdoorSessionKind,
  CasdoorTenantPermission,
  CasdoorTenantPolicy,
  CasdoorMemberRevocation,
  CasdoorGatewayHealth,
  CasdoorTenantHealth,
  CasdoorCreditAccount,
  CasdoorCreditLedgerEntry,
  CasdoorAiCapabilities,
  CasdoorCommercialModelCatalog,
  CasdoorLoginCapabilities,
} from "../index";
