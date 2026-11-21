import { keyLabel } from "@/shared/lib/shortcuts";
import { ShortcutList } from "../../../app/palette/ShortcutsPanel";
import { useLocale } from "@/shared/i18n";
import { SectionShell } from "./shared";

// ---------- 快捷键 ----------

export function ShortcutsSettingsPanel() {
  const { t } = useLocale();
  // Generated from the one registry the handlers use (20261115-ui U8.2): only shortcuts that work.
  return (
    <SectionShell title={t("shortcuts.title")} desc={t("shortcuts.desc", { mod: keyLabel("Mod") })}>
      <ShortcutList />
    </SectionShell>
  );
}
