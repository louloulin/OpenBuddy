/**
 * @openbuddy/auth-policy — 统一授权决策中心 (P1.1)
 *
 * 公开 API:
 *   - types: AuthorizationRequest / AuthorizationDecision / AuthorizationEvaluator / ...
 *   - pipeline: AuthorizationPipeline / createDefaultPipeline
 *   - evaluators: PiPermissionEvaluator / CasdoorEvaluator
 *
 * 用法示例:
 *   ```ts
 *   import { createDefaultPipeline, PiPermissionEvaluator, CasdoorEvaluator } from "@openbuddy/auth-policy";
 *   import { evaluateViaBridge } from "@openbuddy/host-runtime"; // or agentPermissionBridge
 *
 *   const pipeline = createDefaultPipeline()
 *     .addEvaluator(new PiPermissionEvaluator({
 *       rules: await agentPermissionBridge.readRules(),
 *       evaluateViaBridge: evaluateViaBridge,
 *     }))
 *     .addEvaluator(new CasdoorEvaluator({
 *       identity: casdoorAuth.identity(),
 *       authorize: (input) => casdoorAuth.authorize(input),
 *     }));
 *
 *   const decision = await pipeline.decide({
 *     subject: "user-1",
 *     action: "bash.run",
 *     resource: "bash",
 *     context: { tool: "bash", pattern: "rm -rf /" },
 *   });
 *   if (!decision.allowed) throw new Error(`denied: ${decision.code}`);
 *   ```
 */

export * from "./types.js";
export { AuthorizationPipeline, createDefaultPipeline } from "./pipeline.js";
export { PiPermissionEvaluator } from "./evaluators/pi-evaluator.js";
export type { PiPermissionEvaluatorOptions } from "./evaluators/pi-evaluator.js";
export { CasdoorEvaluator } from "./evaluators/casdoor-evaluator.js";
export type { CasdoorEvaluatorOptions, CasdoorIdentityLike } from "./evaluators/casdoor-evaluator.js";
export { FolderTrustEvaluator } from "./evaluators/folder-trust-evaluator.js";
export type { FolderTrustEvaluatorOptions } from "./evaluators/folder-trust-evaluator.js";
export { PluginCapabilityEvaluator } from "./evaluators/plugin-capability-evaluator.js";
export type { PluginCapabilityEvaluatorOptions } from "./evaluators/plugin-capability-evaluator.js";
export { createHostCoreAuditWriter } from "./audit-bridge.js";
export type { AuditAppendFn, CreateAuditWriterOptions } from "./audit-bridge.js";
