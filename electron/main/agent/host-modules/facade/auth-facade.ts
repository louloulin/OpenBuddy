/**
 * host-modules/facade/auth-facade.ts
 *
 * v6-G M2 — 提取 authStatus / providerCatalog / 认证相关 helpers 到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import { authStatus as authStatusImpl } from "../agent-model";
import { providerCatalog as providerCatalogImpl } from "../agent-model";

export function buildAuthFacade() {
  return {
    authStatus: async () => authStatusImpl(),
    providerCatalog: async () => providerCatalogImpl(),
  };
}
