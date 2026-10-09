/**
 * PluginCapabilityEvaluator — 把插件能力/信任检查接到 AuthorizationPipeline (P1.5)
 *
 * 行为:
 *   - 只在 context.plugin 存在时匹配
 *   - evaluate → 调 caller 注入的 isPluginAllowed(plugin, action)
 *   - true  → PLUGIN_CAPABILITY_ALLOWED + allowed=true
 *   - false → PLUGIN_CAPABILITY_DENIED + allowed=false
 *
 * 集成路径:
 *   - caller 提供 isPluginAllowed(plugin, action) 包装
 *   - 通常包装 marketplace + R41 InstallPreflight 的输出
 *     (plugin hash 校验 / capability versioning / signature check)
 *
 * 单元测试: `__tests__/plugin-capability-evaluator.test.ts`
 */

import type {
  AuthorizationDecision,
  AuthorizationEvaluator,
  AuthorizationRequest,
  AuthorizationSource,
} from "../types.js";

export interface PluginCapabilityEvaluatorOptions {
  /**
   * 注入的 plugin 能力检查函数。
   *   - plugin: 插件名(manifest name)
   *   - action: 抽象动作("execute" / "load" / "register")
   * 返回 true 表示允许,false 表示拒绝。
   */
  isPluginAllowed: (plugin: string, action: string) => boolean | Promise<boolean>;
}

export class PluginCapabilityEvaluator implements AuthorizationEvaluator {
  readonly name: AuthorizationSource = "plugin_capability";
  readonly priority: number = 20; // 最后兜底
  private readonly isPluginAllowed: PluginCapabilityEvaluatorOptions["isPluginAllowed"];

  constructor(options: PluginCapabilityEvaluatorOptions) {
    this.isPluginAllowed = options.isPluginAllowed;
  }

  matches(req: AuthorizationRequest): boolean {
    return typeof req.context?.plugin === "string" && req.context.plugin.length > 0;
  }

  async evaluate(req: AuthorizationRequest): Promise<AuthorizationDecision | null> {
    const plugin = req.context!.plugin as string;
    const allowed = await this.isPluginAllowed(plugin, req.action);

    if (allowed) {
      return {
        allowed: true,
        reason: `plugin capability allowed: ${plugin}.${req.action}`,
        code: "PLUGIN_CAPABILITY_ALLOWED",
        source: "plugin_capability",
        matchedRule: `${plugin}:${req.action}`,
      };
    }
    return {
      allowed: false,
      reason: `plugin capability denied: ${plugin}.${req.action}`,
      code: "PLUGIN_CAPABILITY_DENIED",
      source: "plugin_capability",
      matchedRule: `${plugin}:${req.action}`,
    };
  }
}
