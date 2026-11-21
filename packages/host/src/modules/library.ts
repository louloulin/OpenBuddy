import { text } from "@openbuddy/services/settings/settings";
import { LibraryService } from "@openbuddy/services/library/library";
import type { Handler, HostContext, HostModule } from "../module.js";

/**
 * §5.3 `library` module (pii W5.5): persistent knowledge sources for 资料库 · 知识库. 记忆 has its
 * own module and 我的文件 reads `list_dir`, so this only owns `library.json`.
 */
export function libraryModule(ctx: HostContext): HostModule {
  let service: LibraryService | undefined;
  const library = () => (service ??= new LibraryService(ctx.settings));
  const commands: Record<string, Handler> = {
    library_list: () => library().prune(),
    library_add: (p) => library().addFolder(text(p.path)),
    library_remove: (p) => library().remove(text(p.id)),
  };
  return { id: "library", commands };
}
