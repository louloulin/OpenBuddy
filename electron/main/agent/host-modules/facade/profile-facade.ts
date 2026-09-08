/**
 * host-modules/facade/profile-facade.ts
 *
 * v6-G M1 — 把 agent-host.ts 中 profile helpers
 * (resource paths / watchers / patches / packages) 提取到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
import { piHome } from "../_host-paths";
import {
  setProfilePiResourcePaths as setProfilePiResourcePathsImpl,
  refreshMarketplacePiResourcePaths as refreshMarketplacePiResourcePathsImpl,
  profileArtifactModuleUrl as profileArtifactModuleUrlImpl,
  nativePiResourcePaths as nativePiResourcePathsImpl,
} from "../profile/resource-paths";
import { refreshPiExtensions as refreshPiExtensionsImpl } from "../pi-runtime-refresh";
import {
  marketplaceArtifactPackagePaths as marketplaceArtifactPackagePathsImpl,
  artifactPackagePaths as artifactPackagePathsImpl,
  profilePatchPaths as profilePatchPathsImpl,
  profileResourceWatchPaths as profileResourceWatchPathsImpl,
} from "../profile/paths";
import {
  startProfileWatchers as startProfileWatchersImpl,
  stopProfileWatchers as stopProfileWatchersImpl,
} from "../profile/watchers";
import { scheduleProfileReload } from "../profile-reload-transaction";
import { listProfileRemoteContributions as listProfileRemoteContributionsImpl } from "../_surface/profile-remote-contributions";
import { installDefaultPiPackages as installDefaultPiPackagesImpl } from "../default-pi-package-installer";
import { profilePackages as profilePackagesImpl } from "../profile/unified-packages";
import {
  listAllPiSessions as listAllPiSessionsImpl,
  persistedSessionPath as persistedSessionPathImpl,
} from "../pi-runtime-factories";

export function buildProfileFacade(state: AgentHostState) {
  const profileResourceWatchPathsFn = (): string[] =>
    profileResourceWatchPathsImpl(state.profileOptions, state.profilePackagePaths, piHome);
  return {
    setProfilePiResourcePaths: (paths: {
      extensions: readonly string[];
      skills: readonly string[];
      prompts: readonly string[];
      themes: readonly string[];
    }) => setProfilePiResourcePathsImpl(paths),
    refreshMarketplacePiResourcePaths: () => refreshMarketplacePiResourcePathsImpl(),
    profileArtifactModuleUrl: (path: string) => profileArtifactModuleUrlImpl(path),
    refreshPiExtensions: () => refreshPiExtensionsImpl(),
    profilePatchPaths: () => profilePatchPathsImpl(state.profileOptions, piHome),
    profileResourceWatchPaths: () => profileResourceWatchPathsFn(),
    marketplaceArtifactPackagePaths: () => marketplaceArtifactPackagePathsImpl(state.cwd ?? null),
    artifactPackagePaths: () => artifactPackagePathsImpl(state.profilePackagePaths, state.cwd ?? null),
    stopProfileWatchers: () => stopProfileWatchersImpl(state),
    nativePiResourcePaths: () => nativePiResourcePathsImpl(),
    listAllPiSessions: () => listAllPiSessionsImpl(),
    persistedSessionPath: (sessionId: string | undefined) => persistedSessionPathImpl(sessionId),
    startProfileWatchers: () =>
      startProfileWatchersImpl(state, scheduleProfileReload, profileResourceWatchPathsFn),
    listProfileRemoteContributions: () => listProfileRemoteContributionsImpl(state),
    profilePackages: () => profilePackagesImpl(),
    installDefaultPiPackages: (options?: { force?: boolean }) => installDefaultPiPackagesImpl(options),
  };
}
