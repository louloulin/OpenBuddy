/**
 * PiRecentlyPublished — 主页顶部的 "Recently published" 区(pi.dev 风格)。
 *
 * 入参:已按 updatedAt 倒序排好的 entry 列表;组件只取前 N 条做链接列表。
 * 复用 MarketplaceEntry 的 publisher / version,但不展示下载量 — 该区只
 * 强调"新发布",把决策权留给下方主列表。
 */
import { useMemo } from "react";
import { formatRelative } from "./format";
import type { MarketplaceEntry } from "../marketplace-model";
import styles from "./PiRecentlyPublished.module.css";

export interface PiRecentlyPublishedProps {
  entries: readonly MarketplaceEntry[];
  /** 顶部小标题(默认 "Recently published")。 */
  heading?: string;
  /** 最多展示多少条(默认 7,pi.dev 也是 7)。 */
  max?: number;
  onOpen?: (entry: MarketplaceEntry) => void;
  /**
   * 当前 toolbar 的搜索词。本组件不参与过滤(Recently published 始终展示生态最近),
   * 但会把命中的子串标 `<mark>` 出来,让用户知道"哪些最近发布的有命中"。
   */
  query?: string;
  className?: string;
}

/**
 * 在文本里把 query 的所有出现都包成 `<mark>`,与 PiPackageCard.Highlighted 行为一致。
 * - 空 query:返回原文;
 * - 无匹配:返回原文;
 * - 多次出现:全部标,防 Turkish dotted-i 之类的 lowercasing 长度偏差。
 */
function highlight(text: string, query: string, keyPrefix: string): React.ReactNode {
  if (!query) return text;
  const trimmed = query.trim();
  if (!trimmed) return text;
  const lower = text.toLowerCase();
  const lowerNeedle = trimmed.toLowerCase();
  if (lower.indexOf(lowerNeedle) < 0) return text;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  let safety = 0;
  while (cursor < text.length && safety < 32) {
    safety += 1;
    const next = text.toLowerCase().indexOf(lowerNeedle, cursor);
    if (next < 0) break;
    if (next > cursor) out.push(text.slice(cursor, next));
    out.push(
      <mark key={`${keyPrefix}-${next}-${cursor}`} className={styles.mark}>
        {text.slice(next, next + lowerNeedle.length)}
      </mark>,
    );
    cursor = next + lowerNeedle.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out.length === 0 ? text : out;
}

export function PiRecentlyPublished(props: PiRecentlyPublishedProps) {
  const { entries, heading = "Recently published", max = 7, onOpen, className, query = "" } = props;

  const items = useMemo(() => {
    return [...entries]
      .filter((entry) => Boolean(entry.updatedAt))
      .sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""))
      .reverse()
      .slice(0, max);
  }, [entries, max]);

  if (items.length === 0) {
    return null;
  }

  return (
    <section
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-testid="pi-recently-published"
    >
      <h2 className={styles.heading}>{heading}</h2>
      <ul className={styles.list} role="list">
        {items.map((entry) => {
          const age = formatRelative(entry.updatedAt);
          return (
            <li key={entry.id} className={styles.item}>
              <button
                type="button"
                className={styles.link}
                onClick={() => onOpen?.(entry)}
                data-testid="pi-recently-link"
                data-entry-id={entry.id}
                aria-label={`Open ${entry.name}${age ? `, published ${age}` : ""}`}
              >
                <strong className={styles.name}>{highlight(entry.name, query, "name")}</strong>
                <span className={styles.description}>{highlight(entry.description, query, "desc")}</span>
                {age ? <span className={styles.age} aria-hidden>{age}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
