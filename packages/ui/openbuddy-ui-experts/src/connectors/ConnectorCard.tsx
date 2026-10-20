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
  // 卡片内嵌了一个真实 <button>(配置 / 连接),把容器本身换成 <button>
  // 会产生非法的按钮嵌套,因此这里保留容器元素,补上 role + tabIndex + 键盘
  // 事件,让键盘用户至少能激活卡片主体打开详情。
  const openFromCard = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(connector); }
  };
  return (
    <div className="cn-card" role="button" tabIndex={0}
      onClick={() => onOpen(connector)}
      onKeyDown={openFromCard}>
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
    </div>
  );
}
