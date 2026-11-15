import type { HostModuleFactory } from "../module.js";
import { sessionModule } from "./session.js";
import { turnModule } from "./turn.js";
import { modelModule } from "./model.js";
import { providersModule } from "./providers.js";
import { approvalsModule } from "./approvals.js";
import { extensionsModule } from "./extensions.js";
import { skillsModule } from "./skills.js";
import { mcpModule } from "./mcp.js";
import { notificationsModule } from "./notifications.js";
import { artifactsModule } from "./artifacts.js";
import { filesModule } from "./files.js";
import { hostModule } from "./host.js";
import { expertsModule } from "./experts.js";
import { memoryModule } from "./memory.js";
/**
 * The §5.3 host modules, in assembly order. `files` stays last: its service handlers were
 * spread after the command literal before the split, so it keeps the last word on a key.
 */
export const HOST_MODULES: readonly HostModuleFactory[] = [
  sessionModule,
  turnModule,
  modelModule,
  providersModule,
  approvalsModule,
  extensionsModule,
  skillsModule,
  mcpModule,
  notificationsModule,
  artifactsModule,
  expertsModule,
  memoryModule,
  hostModule,
  filesModule,
];
