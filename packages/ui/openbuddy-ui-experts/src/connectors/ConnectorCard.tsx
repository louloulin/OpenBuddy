import type { ConnectorItem } from "@openbuddy/shared-types";
import { AddIcon, CheckIcon, RefreshCwIcon } from "@openbuddy/ui-primitives/icons";
import { ConnectorIcon } from "../shared/ConnectorIcon";
import type { ConnectorAuthState } from "./ConnectorsTab";

const BADGE: Record<ConnectorAuthState, { text: string; cls: string } | null> = {
  none: null,
  installed: { text: "已连接", cls: "cn-badge--ok" },
  authed: { text: "已授权", cls: "cn-badge--ok" },
  "needs-auth": { text: "待授权", cls: "cn-badge--warn" },
};

/** One connector card in the directory grid. Clicking the card body opens the
 *  detail modal; the `+` button is a shortcut to configure/connect. */
export function ConnectorCard({
  connector, authState = "none", onOpen, onConfigure, root,
}: {
  connector: ConnectorItem;
  authState?: ConnectorAuthState;
  onOpen: (c: ConnectorItem) => void;
  onConfigure: (c: ConnectorItem) => void;
  root?: string;
}) {
  const badge = BADGE[authState];
  const connected = authState === "installed" || authState === "authed";
  return (
    <article className="cn-card" onClick={() => onOpen(connector)}>
      <ConnectorIcon local={connector.iconLocal} name={connector.name} size={36} shape="square" root={root} />
      <div className="cn-card-info">
        <div className="cn-card-name">
          {connector.name}
          {badge && <span className={`cn-badge ${badge.cls}`}>{badge.text}</span>}
        </div>
        <p className="cn-card-desc">{connector.desc}</p>
      </div>
      <button type="button" className="sk-add"
        title={connected ? "重新配置" : authState === "needs-auth" ? "去授权" : "配置 / 连接"}
        onClick={(e) => { e.stopPropagation(); onConfigure(connector); }}>
        {connected ? <CheckIcon size="sm" /> : authState === "needs-auth" ? <RefreshCwIcon size="sm" /> : <AddIcon size="sm" />}
      </button>
    </article>
  );
}
