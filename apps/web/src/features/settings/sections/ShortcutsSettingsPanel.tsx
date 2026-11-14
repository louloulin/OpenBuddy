import { keyLabel } from "@/shared/lib/shortcuts";
import { ShortcutList } from "../../../app/palette/ShortcutsPanel";
import { SectionShell } from "./shared";

// ---------- 快捷键 ----------

export function ShortcutsSettingsPanel() {
  // Generated from the one registry the handlers use (20261115-ui U8.2): only shortcuts that work.
  return (
    <SectionShell title="快捷键" desc={`按 ${keyLabel("Mod")}+/ 随时查看这份列表。`}>
      <ShortcutList />
    </SectionShell>
  );
}
