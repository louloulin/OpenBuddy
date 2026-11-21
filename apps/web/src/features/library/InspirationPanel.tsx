import { useCallback, useMemo, useState } from "react";
import {
  SearchIcon, LightbulbIcon, SparklesIcon, AddCircleIcon, ChevronRightIcon,
} from "@openbuddy/ui/icon/icons/index";
import { promptsSave } from "@openbuddy/client/agent-client";
import { HOME_MODES, type HomeModeId } from "../../shared/content/scenes";

/**
 * 灵感 (pii W2.8 / S8): static scene cards, no generation.
 *
 * The old panel asked a model to invent cards (`inspiration_generate`, never implemented). This
 * version reuses the home page's built-in scenes (`shared/content/scenes.ts`): 每个模板一张卡，
 * 可以直接开工（填入首页输入框），也可以一键存成「我的指令」，之后在对话里 `/名字` 调用。
 */
interface InspirationPanelProps {
  cwd?: string;
  onToast?: (msg: string) => void;
  onLaunch?: (prompt: string) => void;
}

interface SceneCard {
  key: string;
  mode: HomeModeId;
  modeLabel: string;
  category: string;
  title: string;
  prompt: string;
  /** Stable 我的指令 name (ASCII, filesystem-safe). */
  command: string;
}

/** Every template of every scene, flattened into one card list. */
const CARDS: SceneCard[] = HOME_MODES.flatMap((mode) =>
  mode.categories.flatMap((category, categoryIndex) =>
    category.templates.map((template, templateIndex) => ({
      key: `${mode.id}-${category.id}-${templateIndex}`,
      mode: mode.id,
      modeLabel: mode.label,
      category: category.label,
      title: template.title,
      prompt: template.prompt,
      command: `scene-${mode.id}-${categoryIndex + 1}-${templateIndex + 1}`,
    })),
  ),
);

const MODES: Array<{ id: HomeModeId | "all"; label: string }> = [
  { id: "all", label: "全部" },
  ...HOME_MODES.map((mode) => ({ id: mode.id, label: mode.label })),
];

export function InspirationPanel({ cwd, onToast, onLaunch }: InspirationPanelProps) {
  const [mode, setMode] = useState<HomeModeId | "all">("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<SceneCard | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CARDS.filter((card) => {
      if (mode !== "all" && card.mode !== mode) return false;
      if (!q) return true;
      return [card.title, card.prompt, card.category, card.modeLabel].some((text) => text.toLowerCase().includes(q));
    });
  }, [mode, query]);

  const saveAsCommand = useCallback(async (card: SceneCard) => {
    setBusy(card.key);
    try {
      await promptsSave({ name: card.command, description: `${card.modeLabel} · ${card.title}`, content: card.prompt }, "global", cwd);
      onToast?.(`已存为我的指令：对话里输入 /${card.command} 就能用（可在 专家·技能·连接器 · 我的指令 里编辑）`);
    } catch (e) {
      onToast?.(`保存失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy("");
    }
  }, [cwd, onToast]);

  return (
    <div className="inspiration">
      <header className="inspiration__head">
        <div>
          <h2 className="inspiration__title"><LightbulbIcon size="md" /> 灵感</h2>
          <p className="inspiration__hint">内置场景，不需要联网。选一个直接开工，或存成「我的指令」以后用 / 调用。</p>
        </div>
        <div className="inspiration__search">
          <SearchIcon size="md" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索场景…" aria-label="搜索场景" />
        </div>
      </header>

      <div className="inspiration__chips" role="tablist" aria-label="场景">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            className={"inspiration__chip" + (mode === item.id ? " inspiration__chip--on" : "")}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="inspiration__empty">
          <SparklesIcon size="xl" className="ec-empty-icon" />
          <p>没有匹配的场景，换个关键词试试。</p>
        </div>
      ) : (
        <div className="inspiration__grid">
          {visible.map((card) => (
            <article key={card.key} className="inspiration-card">
              <div className="inspiration-card__meta">
                <span className="inspiration-card__mode">{card.modeLabel}</span>
                <span className="inspiration-card__cat">{card.category}</span>
              </div>
              <h3 className="inspiration-card__title">{card.title}</h3>
              <p className="inspiration-card__prompt">{card.prompt}</p>
              <div className="inspiration-card__actions">
                <button
                  type="button"
                  className="inspiration-card__go"
                  onClick={() => { if (onLaunch) onLaunch(card.prompt); else setPreview(card); }}
                >
                  用这个开工 <ChevronRightIcon size="sm" />
                </button>
                <button
                  type="button"
                  className="inspiration-card__save"
                  disabled={busy === card.key}
                  onClick={() => { void saveAsCommand(card); }}
                >
                  <AddCircleIcon size="sm" /> {busy === card.key ? "保存中…" : "存为指令"}
                </button>
                <code className="inspiration-card__command">/{card.command}</code>
              </div>
            </article>
          ))}
        </div>
      )}

      {preview && (
        <div className="inspiration-preview" role="dialog" aria-label={`场景 ${preview.title}`} onClick={() => setPreview(null)}>
          <div className="inspiration-preview__card" onClick={(e) => e.stopPropagation()}>
            <h3 className="inspiration-preview__title">{preview.title}</h3>
            <p className="inspiration__hint">复制这段提示词，或回到首页输入框使用。</p>
            <pre className="inspiration-preview__text">{preview.prompt}</pre>
            <div className="inspiration-preview__actions">
              <button type="button" className="inspiration-card__save" onClick={() => { void saveAsCommand(preview); }}>
                存为指令 /{preview.command}
              </button>
              <button type="button" className="inspiration-card__go" onClick={() => setPreview(null)}>知道了</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
