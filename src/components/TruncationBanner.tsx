import React from "react";

export interface TruncationInfo { sessionId: string; truncatedAt: string | number; byteCount: number; sourceDocumentId?: string; originalName?: string; }
export interface TruncationBannerProps { truncation: TruncationInfo; onDismiss: (sessionId: string) => void; onRestore: (sessionId: string) => void | Promise<void>; }

export function TruncationBanner({ truncation, onDismiss, onRestore }: TruncationBannerProps) {
  return <div role="status" aria-live="polite" data-session-id={truncation.sessionId} className="truncation-banner">
    <span>{truncation.originalName ?? "Document"} was truncated ({truncation.byteCount.toLocaleString()} bytes).</span>
    <button type="button" onClick={() => void onRestore(truncation.sessionId)}>Restore full document</button>
    <button type="button" onClick={() => onDismiss(truncation.sessionId)}>Ignore</button>
  </div>;
}
export default TruncationBanner;
