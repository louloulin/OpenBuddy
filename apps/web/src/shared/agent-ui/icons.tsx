/** Small inline glyphs for the chat action bar (stroke icons, theme-colored). */
const base = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const CopyGlyph = () => (<svg {...base}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>);
export const RetryGlyph = () => (<svg {...base}><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></svg>);
export const ThumbUpGlyph = ({ filled }: { filled?: boolean }) => (<svg {...base} fill={filled ? "currentColor" : "none"}><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Zm0 0 4-7a2.5 2.5 0 0 1 3 2.6L13.5 9H19a2 2 0 0 1 2 2.3l-1.2 7.5A2.5 2.5 0 0 1 17.3 21H7" /></svg>);
export const ThumbDownGlyph = ({ filled }: { filled?: boolean }) => (<svg {...base} fill={filled ? "currentColor" : "none"}><path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3Zm0 0-4 7a2.5 2.5 0 0 1-3-2.6l.5-3.4H5a2 2 0 0 1-2-2.3l1.2-7.5A2.5 2.5 0 0 1 6.7 3H17" /></svg>);
export const MoreGlyph = () => (<svg {...base}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>);
export const EditGlyph = () => (<svg {...base}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>);
export const ChevronGlyph = ({ open }: { open?: boolean }) => (<svg {...base} width={12} height={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }}><path d="m9 6 6 6-6 6" /></svg>);
export const FileGlyph = () => (<svg {...base} width={13} height={13}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /></svg>);
export const AlertGlyph = () => (<svg {...base} width={16} height={16}><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5v.01" /></svg>);
