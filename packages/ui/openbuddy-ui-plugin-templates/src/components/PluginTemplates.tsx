/**
 * Plugin Templates — 4 starter scaffolds for plugin authors.
 * Phase 2 / C3.
 *
 * Mirrors PI-Desktop `apps/desktop/components/PluginMarketplaceTemplates.tsx`:
 *  1. `panel-basic` — single-tab UI extension (e.g. sidebar widget)
 *  2. `agent-tool-basic` — single tool the agent can invoke
 *  3. `skill-pack` — declarative skill bundle (no code, pure prompts)
 *  4. `full-demo` — combined panel + tool + skill for reference
 *
 * Each card links to the in-app "Create plugin from template" flow which
 * copies the starter files into the user's selected workspace path.
 */
import styles from "./PluginTemplates.module.css";

export type PluginTemplateId = "panel-basic" | "agent-tool-basic" | "skill-pack" | "full-demo";

export interface PluginTemplate {
  id: PluginTemplateId;
  name: string;
  description: string;
  /** File extensions that show in the preview pane. */
  files: readonly { path: string; language: string; preview: string }[];
  /** Tags used by the marketplace search. */
  tags: readonly string[];
}

export const DEFAULT_TEMPLATES: readonly PluginTemplate[] = [
  {
    id: "panel-basic",
    name: "Panel — basic",
    description: "Single-tab UI extension with one button. Minimal scaffolding for sidebar widgets.",
    files: [
      { path: "openbuddy.plugin.json", language: "json", preview: JSON.stringify({ schema: "openbuddy.plugin.v1", id: "demo.panel", version: "0.1.0", surface: "ui", provides: [{ type: "panel", name: "demo-panel" }] }, null, 2) },
      { path: "src/Panel.tsx", language: "tsx", preview: "export function Panel() {\n  return <div>Hello from demo</div>;\n}\n" },
    ],
    tags: ["starter", "ui", "panel"],
  },
  {
    id: "agent-tool-basic",
    name: "Agent tool — basic",
    description: "Single tool the agent can invoke. Returns a structured payload.",
    files: [
      { path: "openbuddy.plugin.json", language: "json", preview: JSON.stringify({ schema: "openbuddy.plugin.v1", id: "demo.tool", provides: [{ type: "tool", name: "demo-hello" }] }, null, 2) },
      { path: "src/tool.ts", language: "ts", preview: "export const tool = {\n  name: 'demo-hello',\n  description: 'Says hello',\n  run: async () => ({ content: 'Hello!' })\n};\n" },
    ],
    tags: ["starter", "tool", "agent"],
  },
  {
    id: "skill-pack",
    name: "Skill pack",
    description: "Declarative skill — no plugin.ts required. Pure prompt bundle the agent can load on demand.",
    files: [
      { path: "skill.yaml", language: "yaml", preview: "id: demo-skill\nname: Demo skill\nprompt: |\n  You are a helpful assistant specialised in demos.\n" },
    ],
    tags: ["starter", "skill", "prompt"],
  },
  {
    id: "full-demo",
    name: "Full demo",
    description: "Combined panel + tool + skill. Use as a reference when wiring multiple surfaces.",
    files: [
      { path: "openbuddy.plugin.json", language: "json", preview: "// combined manifest — see individual templates above for shapes" },
      { path: "src/Panel.tsx", language: "tsx", preview: "// panel\n" },
      { path: "src/tool.ts", language: "ts", preview: "// tool\n" },
      { path: "skill.yaml", language: "yaml", preview: "// skill\n" },
    ],
    tags: ["starter", "reference", "full"],
  },
];

export interface PluginTemplatesProps {
  templates?: readonly PluginTemplate[];
  onUseTemplate?: (template: PluginTemplate) => void;
  onPreview?: (template: PluginTemplate) => void;
  className?: string;
}

export function PluginTemplates(props: PluginTemplatesProps) {
  const { templates = DEFAULT_TEMPLATES, onUseTemplate, onPreview, className } = props;
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")} data-testid="plugin-templates">
      <h2 className={styles.title}>Plugin templates</h2>
      <p className={styles.subtitle}>Four starters — copy into your workspace and customise.</p>
      <ul className={styles.grid}>
        {templates.map((t) => (
          <li key={t.id} className={styles.card} data-testid={`template-${t.id}`}>
            <header className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>{t.name}</h3>
              <ul className={styles.tags}>
                {t.tags.map((tag) => (
                  <li key={tag} className={styles.tag}>{tag}</li>
                ))}
              </ul>
            </header>
            <p className={styles.description}>{t.description}</p>
            <div className={styles.preview}>
              {t.files.slice(0, 1).map((f) => (
                <pre key={f.path} className={styles.previewBlock}><code>{f.preview}</code></pre>
              ))}
            </div>
            <div className={styles.actions}>
              {onPreview ? (
                <button type="button" className={styles.btn} onClick={() => onPreview(t)} data-testid={`template-preview-${t.id}`}>
                  Preview
                </button>
              ) : null}
              {onUseTemplate ? (
                <button type="button" className={styles.btnPrimary} onClick={() => onUseTemplate(t)} data-testid={`template-use-${t.id}`}>
                  Use template
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
