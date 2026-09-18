/**
 * @openbuddy/ui-library/client — apply() 注册资料库页与 4 个内置分区。
 *
 * 内置分区走的是和插件完全相同的 `library.section` 槽(而不是写死在页面里):
 *   - 插件可以只追加一个分区就完成扩展;
 *   - 插件也可以用更高优先级注册同 id 分区,顶掉某个内置分区;
 *   - `ui-slot-audit` 因此能看到"声明 / 注册 / 消费"三方齐全。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { LibraryPage } from "./LibraryPage";
import { LIBRARY_SECTIONS } from "./sections";

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers: Array<() => void> = [
    ctx.slots.register(
      {
        name: "placeholder.library",
        kind: "single",
        scope: "root",
        registrant: "@openbuddy/ui-library",
      },
      LibraryPage as never,
    ),
  ];

  for (const Section of LIBRARY_SECTIONS) {
    disposers.push(
      ctx.slots.register(
        {
          name: "library.section",
          kind: "list",
          scope: "root",
          id: Section.librarySection.id,
          registrant: "@openbuddy/ui-library",
        },
        Section as never,
      ),
    );
  }

  return () => {
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
  };
}
