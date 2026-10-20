// packages/capability/openbuddy-email/src/renderer/index.ts
//
// Tier 2 入口:ui-* 包只允许通过 `./renderer` 子路径访问 capability-email。
// 本文件只 re-export 类型与 React context(无 service 实例),
// 避免 ui-* 包意外 import Cordis service / Node-only fs 模块。
export type {
  EmailAccount,
  EmailAddress,
  EmailAnalysisContextCitation,
  EmailAnalysisRecord,
  EmailConnection,
  EmailConnectionReadiness,
  EmailFolder,
  EmailManagementCapability,
  EmailMutationKind,
  EmailProviderDiagnostic,
  EmailProviderReadiness,
  EmailSenderPolicy,
  EmailThread,
  EmailThreadPreview,
} from "../index";
