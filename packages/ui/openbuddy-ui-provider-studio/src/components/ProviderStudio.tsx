/**
 * Provider Studio — visual editor for AI providers and OAuth credentials.
 * Phase 2 / C2.
 *
 * Mirrors PI-Desktop `apps/desktop/components/ConfigurationProviderStudio.tsx`
 * (ADR 0020). Each provider card shows:
 *   - friendly name + provider type (openai-compatible / anthropic / azure / local)
 *   - current credential status (configured / missing / error)
 *   - inline OAuth flow starter ("Connect with…")
 *   - test connection button
 *
 * The studio is intentionally read-only against persisted secrets: the actual
 * credential write happens through host-core `secrets.set`. This component
 * only owns the user-facing flow.
 */
import { useState } from "react";
import styles from "./ProviderStudio.module.css";

export type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "azure-openai"
  | "google-vertex"
  | "bedrock"
  | "ollama"
  | "custom";

export type ProviderStatus = "configured" | "missing" | "error" | "connecting";

export interface ProviderDescriptor {
  id: string;
  name: string;
  kind: ProviderKind;
  status: ProviderStatus;
  /** Optional human-readable error when status === "error". */
  errorMessage?: string;
  /** Last successful health-check ISO timestamp. */
  lastVerifiedAt?: string;
  /** OAuth providers expose a `connectLabel` for the inline button. */
  connectLabel?: string;
}

export interface ProviderStudioProps {
  providers: readonly ProviderDescriptor[];
  onConfigure?: (id: string) => void;
  onConnect?: (id: string) => void;
  onTest?: (id: string) => Promise<void>;
  onRemove?: (id: string) => void;
  className?: string;
}

export function ProviderStudio(props: ProviderStudioProps) {
  const { providers, onConfigure, onConnect, onTest, onRemove, className } = props;
  const [testing, setTesting] = useState<string | null>(null);

  return (
    <div className={[styles.studio, className].filter(Boolean).join(" ")} data-testid="provider-studio">
      <header className={styles.header}>
        <h2 className={styles.title}>Provider Studio</h2>
        <p className={styles.subtitle}>Configure credentials, test connectivity, and manage OAuth flows.</p>
      </header>
      <ul className={styles.list} role="list">
        {providers.map((p) => (
          <li key={p.id} className={styles.card} data-status={p.status} data-testid={`provider-${p.id}`}>
            <div className={styles.head}>
              <div>
                <div className={styles.name}>{p.name}</div>
                <div className={styles.kind}>{p.kind}</div>
              </div>
              <StatusBadge status={p.status} />
            </div>
            {p.errorMessage ? <div className={styles.error}>{p.errorMessage}</div> : null}
            {p.lastVerifiedAt ? <div className={styles.verified}>Last verified: {p.lastVerifiedAt}</div> : null}
            <div className={styles.actions}>
              {onConfigure ? (
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => onConfigure(p.id)}
                  data-testid={`provider-configure-${p.id}`}
                >
                  Configure
                </button>
              ) : null}
              {onConnect && p.connectLabel ? (
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => onConnect(p.id)}
                  data-testid={`provider-connect-${p.id}`}
                >
                  {p.connectLabel}
                </button>
              ) : null}
              {onTest ? (
                <button
                  type="button"
                  className={styles.btn}
                  onClick={async () => {
                    setTesting(p.id);
                    try { await onTest(p.id); } finally { setTesting(null); }
                  }}
                  disabled={testing === p.id}
                  data-testid={`provider-test-${p.id}`}
                >
                  {testing === p.id ? "Testing…" : "Test"}
                </button>
              ) : null}
              {onRemove ? (
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => onRemove(p.id)}
                  data-testid={`provider-remove-${p.id}`}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: ProviderStatus }) {
  const label = status === "configured" ? "Configured"
    : status === "missing" ? "Missing credentials"
    : status === "error" ? "Error"
    : "Connecting…";
  return <span className={styles.badge} data-status={status} data-testid="provider-status">{label}</span>;
}
