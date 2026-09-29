/**
 * FolderTrustEvaluator — 把文件夹信任决策接到 AuthorizationPipeline (P1.5)
 *
 * 行为:
 *   - 只在 context.folder 存在时匹配
 *   - evaluate → 调 caller 注入的 isFolderTrusted(folder)
 *   - true  → FOLDER_TRUSTED + allowed=true + matchedRule = "<folder>:trusted"
 *   - false → FOLDER_UNTRUSTED + allowed=false + matchedRule = "<folder>:untrusted"
 *
 * 集成路径:
 *   - caller 提供 isFolderTrusted(folder) 包装
 *     (避免本 package 直接依赖 @openbuddy/folder-trust 的具体存储)
 *   - 通常包装 packages/capability/openbuddy-folder-trust 的 JsonFolderTrustStore
 *
 * 单元测试: `__tests__/folder-trust-evaluator.test.ts`
 */

import type {
  AuthorizationDecision,
  AuthorizationEvaluator,
  AuthorizationRequest,
  AuthorizationSource,
} from "../types.js";

export interface FolderTrustEvaluatorOptions {
  /** 注入的 folder trust 检查函数;folder 路径作为入参。 */
  isFolderTrusted: (folder: string) => boolean | Promise<boolean>;
}

export class FolderTrustEvaluator implements AuthorizationEvaluator {
  readonly name: AuthorizationSource = "folder_trust";
  readonly priority: number = 30; // 在 Casdoor 之后
  private readonly isFolderTrusted: FolderTrustEvaluatorOptions["isFolderTrusted"];

  constructor(options: FolderTrustEvaluatorOptions) {
    this.isFolderTrusted = options.isFolderTrusted;
  }

  matches(req: AuthorizationRequest): boolean {
    return typeof req.context?.folder === "string" && req.context.folder.length > 0;
  }

  async evaluate(req: AuthorizationRequest): Promise<AuthorizationDecision | null> {
    const folder = req.context!.folder as string;
    const trusted = await this.isFolderTrusted(folder);

    if (trusted) {
      return {
        allowed: true,
        reason: `folder is trusted: ${folder}`,
        code: "FOLDER_TRUSTED",
        source: "folder_trust",
        matchedRule: `${folder}:trusted`,
      };
    }
    return {
      allowed: false,
      reason: `folder is not trusted: ${folder}`,
      code: "FOLDER_UNTRUSTED",
      source: "folder_trust",
      matchedRule: `${folder}:untrusted`,
    };
  }
}
