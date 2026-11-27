import { memo, useState } from "react";
import { BarChart3, Copy, FileText } from "lucide-react";
import { copyText } from "@openbuddy/platform/clipboard";
import {
  FINANCE_DISCLAIMER,
  FINANCE_KIND_LABEL,
  financeCardMarkdown,
  type FinanceCard,
} from "@openbuddy/chat-core/finance-card";

/**
 * 投研数据卡 (20261126-upup UP-5.2 / 20261127-upup U5)。
 *
 * 只渲染 `detectFinanceCard` 认出的、带 UpUp 来源信封的工具结果：
 * 键值行或表格 + as-of + 来源徽标 + 红涨绿跌 + 固定免责声明。
 * 「生成报告」不在前端拼文件：把整理成报告的请求放进输入框，由模型写文件，
 * 这样报告和其它产物一样进入「本回合产物」，可预览、可撤销。
 */
export const FinanceDataCards = memo(function FinanceDataCards({
  cards,
  onInsertPrompt,
  onToast,
}: {
  cards: FinanceCard[];
  onInsertPrompt?: (text: string) => void;
  onToast?: (message: string) => void;
}) {
  if (!cards.length) return null;
  const report = () => {
    if (!onInsertPrompt) return;
    onInsertPrompt(
      [
        "请把以下数据整理成一份投研报告，保存为 Markdown 文件；保留每项数据的来源与截至时间，结尾附免责声明：",
        "",
        ...cards.map(financeCardMarkdown),
      ].join("\n\n"),
    );
    onToast?.("报告请求已放入输入框");
  };
  return (
    <section className="finance-cards" aria-label="数据卡">
      {cards.map((card) => (
        <FinanceDataCard key={card.toolCallId} card={card} onToast={onToast} />
      ))}
      {onInsertPrompt && (
        <button type="button" className="finance-cards__report" onClick={report}>
          <FileText size={13} aria-hidden /> 生成报告
        </button>
      )}
    </section>
  );
});

function FinanceDataCard({ card, onToast }: { card: FinanceCard; onToast?: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(financeCardMarkdown(card));
      setCopied(true);
      onToast?.("已复制为 Markdown");
    } catch {
      onToast?.("复制失败");
    }
  };
  return (
    <article className={`finance-card finance-card--${card.kind}`} aria-label={`${FINANCE_KIND_LABEL[card.kind]} ${card.title}`}>
      <header className="finance-card__head">
        <BarChart3 size={14} aria-hidden />
        <span className="finance-card__kind">{FINANCE_KIND_LABEL[card.kind]}</span>
        <strong className="finance-card__title">{card.title}</strong>
        <span className="finance-card__source" title={`工具 ${card.toolName}`}>{card.source}</span>
        <button type="button" className="finance-card__copy" aria-label="复制为 Markdown" onClick={() => void copy()}>
          <Copy size={12} aria-hidden />
          {copied ? "已复制" : ""}
        </button>
      </header>
      {card.rows.length > 0 && (
        <dl className="finance-card__rows">
          {card.rows.map((row) => (
            <div key={row.key} className="finance-card__row">
              <dt>{row.label}</dt>
              <dd className={row.tone ? `finance-card__value--${row.tone}` : undefined}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {card.table && (
        <div className="finance-card__table-wrap">
          <table className="finance-card__table">
            <thead>
              <tr>{card.table.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
            </thead>
            <tbody>
              {card.table.rows.map((row, index) => (
                <tr key={index}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {card.table.total > card.table.rows.length && (
            <p className="finance-card__more">共 {card.table.total} 行，显示前 {card.table.rows.length} 行</p>
          )}
        </div>
      )}
      <footer className="finance-card__foot">
        <span>截至 {card.asOf}{card.freshness ? ` · ${card.freshness}` : ""}</span>
        <span className="finance-card__disclaimer">{FINANCE_DISCLAIMER}</span>
      </footer>
    </article>
  );
}
