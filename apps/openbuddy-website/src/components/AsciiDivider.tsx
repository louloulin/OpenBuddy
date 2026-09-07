/**
 * AsciiDivider —— section 之间的工业感分隔
 *
 * 类似 tutti 的 "---- §02 ----" 风格
 * 简洁 monospace + horizontal lines
 */
interface AsciiDividerProps {
  label?: string;
  number?: string;
}

export default function AsciiDivider({ label, number }: AsciiDividerProps) {
  return (
    <div className="ascii-divider">
      { label ? <span>{ label }</span> : null }
      { number ? <span>·</span> : null }
      { number ? <span>§{ number }</span> : null }
    </div>
  );
}