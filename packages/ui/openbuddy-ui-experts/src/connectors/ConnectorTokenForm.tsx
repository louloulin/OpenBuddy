/**
 * Token-authorization form — shown when connecting a `auth_mode: "token"`
 * connector (天眼查 / Bugly / 携程问道 etc.). Renders the connector's
 * `token-schema.json` fields; on submit the collected values are injected as
 * env vars into the connector's MCP servers.
 *
 * Mirrors workbuddy's `ConnectorTokenDialog` / detail-panel token form.
 */
import { useEffect, useRef, useState } from "react";
import type { ConnectorItem } from "@openbuddy/shared-types";
import { OpenExternalIcon } from "@openbuddy/ui-primitives/icons";
import { ConnectorIcon } from "../shared/ConnectorIcon";

interface Props {
  connector: ConnectorItem;
  root?: string;
  /** Values saved from a previous install (read back from mcp.json). */
  initialValues?: Record<string, string>;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}

export function ConnectorTokenForm({ connector, root, initialValues, onClose, onSubmit }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const schema = connector.tokenSchema!;
  const [values, setValues] = useState<Record<string, string>>(initialValues ?? {});

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const requiredFields = schema.fields.filter((f) => f.required);
  const allRequiredFilled = requiredFields.every((f) => (values[f.key] ?? "").trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allRequiredFilled) return;
    onSubmit(values);
  };

  return (
    <div className="ec-modal-overlay" ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <form className="ec-modal" onSubmit={handleSubmit}>
        <button type="button" className="ec-modal-close" onClick={onClose} aria-label="关闭">×</button>

        <div className="ec-modal-header">
          <ConnectorIcon local={connector.iconLocal} name={connector.name} size={48} shape="square" root={root} />
          <div className="ec-modal-info">
            <div className="ec-modal-title">{schema.title || `${connector.name} 授权`}</div>
            {schema.description && <p className="ec-modal-desc">{schema.description}</p>}
          </div>
        </div>

        {schema.docUrl && (
          <a className="cn-token-doclink" href={schema.docUrl} target="_blank" rel="noreferrer">
            <OpenExternalIcon size="sm" /><span>{schema.docLabel || "如何获取？"}</span>
          </a>
        )}

        <div className="cn-token-fields">
          {schema.fields.map((f) => (
            <label key={f.key} className="cn-token-field">
              <span className="cn-token-label">
                {f.label || f.key}
                {f.required && <span className="cn-token-required">*</span>}
              </span>
              <input
                className="cn-token-input"
                type={f.type === "password" ? "password" : "text"}
                placeholder={f.placeholder || ""}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                autoFocus={f === schema.fields[0]}
              />
              {f.description && <span className="cn-token-help">{f.description}</span>}
            </label>
          ))}
        </div>

        <button type="submit" className="ec-modal-summon-btn" disabled={!allRequiredFilled}>
          连接
        </button>
      </form>
    </div>
  );
}
