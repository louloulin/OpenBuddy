/**
 * PiSourcesEditor — 「Pi 扩展」区块里的**源管理**面板(R35)。
 *
 * 为什么需要它:在 R35 之前,`sources.json` 只能手写 —— 而且写完必须重启才生效
 * (源清单在 bridge 构造时定死)。这两件事加起来意味着「配置一个内网镜像源」
 * 是一个要读文档、找数据目录、编辑 JSON、重启应用的流程。对一个把
 * **Plugin SDK / 扩展市场**当成核心差异化的产品,这是最不该有的门槛。
 *
 * 现在:在 UI 里增删源、调权重、保存前先测可达。保存会原子写回 `sources.json`
 * 并**立即**替换内核内存里的源清单,所以点完保存再点「刷新索引」就是新源在跑。
 *
 * 只读源(环境变量 / 宿主注入)照常显示,但标记为只读且不参与保存 —— 让用户
 * 看见它、知道它压着自己,比把它藏起来更诚实。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, ArrowUpCircle } from "lucide-react";
import {
  getPiMarketSources,
  probePiMarketSource,
  setPiMarketSources,
  piMarketErrorInfo,
  type PiMarketSourcesView,
} from "@/lib/pi-market/pi-market-client";
import {
  blankSourceDraft,
  describePiMarketError,
  describeProbeResult,
  moveSourceDraft,
  sourceDraftsDirty,
  sourceStateLabel,
  sourcesToDrafts,
  validateSourceDrafts,
  type PiSourceDraft,
} from "./pi-extensions-model";

interface PiSourcesEditorProps {
  open: boolean;
  onToast?: (message: string) => void;
  /** 保存成功后通知外层:市场条目要重新读(源变了,合并结果也变了)。 */
  onSaved?: (view: PiMarketSourcesView) => void;
}

export function PiSourcesEditor({ open, onToast, onSaved }: PiSourcesEditorProps) {
  const [view, setView] = useState<PiMarketSourcesView | null>(null);
  const [drafts, setDrafts] = useState<readonly PiSourceDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probingIndex, setProbingIndex] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getPiMarketSources();
      setView(next);
      setDrafts(sourcesToDrafts(next));
      setLoadError(null);
    } catch (error) {
      setLoadError(describePiMarketError(piMarketErrorInfo(error)).hint);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const validation = useMemo(() => validateSourceDrafts(drafts), [drafts]);
  const dirty = useMemo(
    () => (view ? sourceDraftsDirty(drafts, view.file) : false),
    [drafts, view],
  );
  const editableCount = drafts.filter((draft) => !draft.readonly).length;

  const patch = useCallback((index: number, next: Partial<PiSourceDraft>) => {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...next } : draft)),
    );
  }, []);

  const handleAdd = useCallback(() => {
    setDrafts((current) => [...current, blankSourceDraft()]);
  }, []);

  const handleRemove = useCallback((index: number) => {
    setDrafts((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleMove = useCallback((index: number, delta: number) => {
    setDrafts((current) => moveSourceDraft(current, index, delta));
  }, []);

  const handleProbe = useCallback(
    async (index: number) => {
      const draft = drafts[index];
      // 用**单独行**的校验结果:一行还没填完不该阻止测试另一行(但这一行
      // 自己得是合法输入,否则测的是"我打错的那串字符")。
      const single = validateSourceDrafts([{ ...draft, readonly: false }]);
      if (!single.ok) {
        patch(index, { probe: single.errors.rows[0] ?? "输入不完整" });
        return;
      }
      setProbingIndex(index);
      try {
        const result = await probePiMarketSource(single.sources[0]);
        patch(index, { probe: describeProbeResult(result) });
      } catch (error) {
        patch(index, { probe: describeProbeResult({ ok: false, entryCount: 0, error: piMarketErrorInfo(error).detail }) });
      } finally {
        setProbingIndex(null);
      }
    },
    [drafts, patch],
  );

  const handleSave = useCallback(async () => {
    if (!validation.ok || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await setPiMarketSources(validation.sources);
      setView(next);
      setDrafts(sourcesToDrafts(next));
      onToast?.(`已保存 ${validation.sources.length} 个源`);
      onSaved?.(next);
    } catch (error) {
      const action = describePiMarketError(piMarketErrorInfo(error));
      setSaveError(`${action.title} —— ${action.hint}`);
    } finally {
      setSaving(false);
    }
  }, [onSaved, onToast, saving, validation]);

  if (!open) return null;

  return (
    <div className="pi-ext-src" data-testid="pi-ext-sources-editor">
      <div className="pi-ext-src__head">
        <span className="pi-ext-src__title">索引源</span>
        <span className="pi-ext-src__meta" data-testid="pi-ext-sources-path">
          {view ? view.filePath : loading ? "读取中…" : "未读取"}
        </span>
      </div>

      <p className="pi-ext-src__hint">
        <ArrowUpCircle size={12} aria-hidden /> 权重大的源先赢;权重相同时<strong>靠上的赢</strong>
        。低权重源里独有的扩展照常收录(镜像补齐);某个源掉线会自动退回它上次成功的缓存。
        <strong>默认不联网</strong>:这里没有源,市场就不会去拉任何远端。
      </p>

      {loadError && (
        <p className="pi-ext__error" role="alert" data-testid="pi-ext-sources-load-error">
          {loadError}
        </p>
      )}

      <ul className="pi-ext-src__list">
        {drafts.map((draft, index) => {
          const rowError = validation.errors.rows[index];
          const stateLabel = sourceStateLabel(draft.status);
          return (
            <li
              key={`${draft.id || "new"}-${index}`}
              className={"pi-ext-src__row" + (draft.readonly ? " pi-ext-src__row--readonly" : "")}
              data-testid="pi-ext-source-row"
              data-readonly={draft.readonly ? "true" : "false"}
              data-invalid={rowError ? "true" : "false"}
            >
              <div className="pi-ext-src__row-main">
                <input
                  className="pi-ext-src__input pi-ext-src__input--url"
                  aria-label={`源 ${index + 1} 地址`}
                  placeholder="https://example.com/pi-extensions/index.json"
                  value={draft.url}
                  readOnly={draft.readonly}
                  onChange={(event) => patch(index, { url: event.target.value, probe: undefined })}
                  data-testid="pi-ext-source-url"
                />
                <input
                  className="pi-ext-src__input"
                  aria-label={`源 ${index + 1} 名称`}
                  placeholder="名称"
                  value={draft.label}
                  readOnly={draft.readonly}
                  onChange={(event) => patch(index, { label: event.target.value })}
                  data-testid="pi-ext-source-label"
                />
                <input
                  className="pi-ext-src__input pi-ext-src__input--num"
                  aria-label={`源 ${index + 1} 权重`}
                  placeholder="权重"
                  inputMode="numeric"
                  value={draft.weight}
                  readOnly={draft.readonly}
                  onChange={(event) => patch(index, { weight: event.target.value })}
                  data-testid="pi-ext-source-weight"
                />
                <input
                  className="pi-ext-src__input pi-ext-src__input--num"
                  aria-label={`源 ${index + 1} 超时(毫秒)`}
                  placeholder="超时"
                  inputMode="numeric"
                  value={draft.timeoutMs}
                  readOnly={draft.readonly}
                  onChange={(event) => patch(index, { timeoutMs: event.target.value })}
                  data-testid="pi-ext-source-timeout"
                />
              </div>

              <div className="pi-ext-src__row-side">
                {draft.readonly && (
                  <span className="pi-ext-src__badge" data-testid="pi-ext-source-readonly">
                    只读
                  </span>
                )}
                {stateLabel && (
                  <span className={"pi-ext__source-chip" + (draft.status ? ` pi-ext__source-chip--${draft.status}` : "")}>
                    {stateLabel}
                    {typeof draft.entryCount === "number" ? (
                      <span className="pi-ext__source-count">{draft.entryCount}</span>
                    ) : null}
                  </span>
                )}
                {draft.probe && (
                  <span className="pi-ext-src__probe" data-testid="pi-ext-source-probe-result">
                    {draft.probe}
                  </span>
                )}
                {!draft.readonly && (
                  <>
                    <button
                      type="button"
                      className="pi-ext-src__icon"
                      onClick={() => void handleProbe(index)}
                      disabled={probingIndex === index}
                      title="测试可达(不保存)"
                      aria-label={`测试源 ${index + 1} 是否可达`}
                      data-testid="pi-ext-source-probe"
                    >
                      {probingIndex === index ? "…" : "测试"}
                    </button>
                    <button
                      type="button"
                      className="pi-ext-src__icon"
                      onClick={() => handleMove(index, -1)}
                      disabled={index === 0 || drafts[index - 1]?.readonly}
                      title="上移(权重相同时靠上的赢)"
                      aria-label={`上移源 ${index + 1}`}
                      data-testid="pi-ext-source-up"
                    >
                      <ChevronUp size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="pi-ext-src__icon"
                      onClick={() => handleMove(index, 1)}
                      disabled={index === drafts.length - 1 || drafts[index + 1]?.readonly}
                      title="下移"
                      aria-label={`下移源 ${index + 1}`}
                      data-testid="pi-ext-source-down"
                    >
                      <ChevronDown size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="pi-ext-src__icon pi-ext-src__icon--danger"
                      onClick={() => handleRemove(index)}
                      title="删除这个源"
                      aria-label={`删除源 ${index + 1}`}
                      data-testid="pi-ext-source-remove"
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </>
                )}
              </div>

              {(rowError || draft.error) && (
                <p className="pi-ext-src__row-error" data-testid="pi-ext-source-row-error">
                  {rowError ?? draft.error}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="pi-ext-src__foot">
        <button
          type="button"
          className="pi-ext__btn"
          onClick={handleAdd}
          data-testid="pi-ext-source-add"
        >
          <Plus size={13} aria-hidden /> 添加源
        </button>
        <span className="pi-ext-src__meta">
          {editableCount} 个可编辑
          {view && view.readonlySourceIds.length > 0
            ? ` · ${view.readonlySourceIds.length} 个只读(环境变量 / 宿主注入)`
            : ""}
        </span>
        <button
          type="button"
          className="pi-ext__btn pi-ext__btn--primary"
          onClick={() => void handleSave()}
          disabled={!dirty || !validation.ok || saving}
          title={
            !validation.ok
              ? "有未修正的错误"
              : dirty
                ? "写回 sources.json 并立即生效"
                : "没有改动"
          }
          data-testid="pi-ext-sources-save"
        >
          {saving ? "保存中…" : dirty ? "保存并生效" : "已保存"}
        </button>
      </div>

      {saveError && (
        <p className="pi-ext__error" role="alert" data-testid="pi-ext-sources-save-error">
          {saveError}
        </p>
      )}
    </div>
  );
}
