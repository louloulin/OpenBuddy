/**
 * CapabilityVersionBadge — 版本关系徽标 + 能力风险摘要 + 升级/回滚入口。
 *
 * 市场卡片与安装对话框共用这一个组件,避免同一套「已是最新 / 可升级 /
 * 可回滚 / 不兼容」文案在两处漂移。所有判断走 marketplace-model 的
 * classifyVersion,组件只负责呈现与回调。
 */
import type { ReactNode } from "react";
import {
  CAPABILITY_RISK_LABELS,
  MARKETPLACE_KIND_LABELS,
  VERSION_RELATION_LABELS,
  capabilityRisk,
  classifyVersion,
  isMajorUpgrade,
  summarizeCapabilities,
  type MarketplaceCapability,
  type MarketplaceEntry,
  type VersionRelation,
} from "./marketplace-model";
import styles from "./CapabilityVersionBadge.module.css";

export interface CapabilityVersionBadgeProps {
  /** 市场推荐版本(候选)。 */
  version: string;
  /** 本地已安装版本;未安装时省略。 */
  current?: string;
  /** 宿主标注的兼容性结论。 */
  incompatible?: boolean;
  /** 安装进行中 — 覆盖其它状态。 */
  installing?: boolean;
  /** 升级动作;缺省时不渲染按钮(只显示状态)。 */
  onUpgrade?: () => void;
  /** 回滚动作;缺省时不渲染按钮。 */
  onRollback?: () => void;
  /** 能力清单;提供后在版本徽标右侧追加风险 chip。 */
  capabilities?: readonly MarketplaceCapability[];
  /** 入口类型 chip(plugin / skill / …)。 */
  kinds?: MarketplaceEntry["kinds"];
  /** 紧凑模式:去掉文案,只留版本号 + 状态点。 */
  compact?: boolean;
  className?: string;
}

const RELATION_TONE: Record<
  VersionRelation,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  same: "success",
  upgrade: "info",
  downgrade: "warning",
  incompatible: "danger",
  unknown: "neutral",
};

/** 判定当前应展示的版本关系(安装中优先)。 */
export function resolveBadgeRelation(props: {
  version: string;
  current?: string;
  incompatible?: boolean;
  installing?: boolean;
}): VersionRelation {
  if (props.installing) return "unknown";
  return classifyVersion(props.current, props.version, { incompatible: props.incompatible });
}

export function CapabilityVersionBadge(props: CapabilityVersionBadgeProps) {
  const {
    version,
    current,
    incompatible,
    installing,
    onUpgrade,
    onRollback,
    capabilities,
    kinds,
    compact,
    className,
  } = props;
  const relation = resolveBadgeRelation({
    version,
    current,
    incompatible: incompatible ?? false,
    installing: installing ?? false,
  });
  const summary = summarizeCapabilities(capabilities, 0);
  const major = relation === "upgrade" && isMajorUpgrade(current, version);

  const label: ReactNode = compact ? (
    version
  ) : (
    <span className={styles.versionLine}>
      <span className={styles.version} data-role="candidate">
        {version}
      </span>
      {current && current !== version ? (
        <span className={styles.current} data-role="current">
          ← {current}
        </span>
      ) : null}
    </span>
  );

  return (
    <div
      className={[styles.root, compact ? styles.compact : "", className].filter(Boolean).join(" ")}
      data-relation={relation}
    >
      <span
        className={styles.versionWrap}
        title={
          current && current !== version ? `已安装 ${current} → 市场 ${version}` : `版本 ${version}`
        }
      >
        {label}
      </span>
      {!compact ? (
        <span
          className={[styles.state, styles[`t_${RELATION_TONE[relation]}`]].join(" ")}
          data-role="relation"
        >
          {installing ? "安装中" : VERSION_RELATION_LABELS[relation]}
        </span>
      ) : null}
      {major ? (
        <span className={styles.breaking} title="主版本升级,可能包含破坏性变更">
          破坏性升级
        </span>
      ) : null}
      {kinds && kinds.length > 0 && !compact ? (
        <span className={styles.kinds} data-role="kinds">
          {kinds.map((kind) => (
            <span key={kind} className={styles.kind}>
              {MARKETPLACE_KIND_LABELS[kind]}
            </span>
          ))}
        </span>
      ) : null}
      {summary.total > 0 && !compact ? (
        <span
          className={[
            styles.risk,
            styles[`r_${summary.riskiest ? capabilityRisk(summary.riskiest) : "low"}`],
          ].join(" ")}
          data-role="risk"
          title={(capabilities ?? [])
            .map(
              (capability) =>
                `${capability.label ?? capability.id}(${CAPABILITY_RISK_LABELS[capabilityRisk(capability)]})`,
            )
            .join("、")}
        >
          {summary.total} 项能力
          {summary.hasHighRisk ? " · 高风险" : summary.hasMediumRisk ? " · 中风险" : ""}
        </span>
      ) : null}
      {!compact && (relation === "upgrade" || relation === "downgrade") ? (
        <span className={styles.actions}>
          {relation === "upgrade" && onUpgrade ? (
            <button
              type="button"
              className={styles.action}
              onClick={onUpgrade}
              data-testid="version-upgrade"
            >
              升级
            </button>
          ) : null}
          {relation === "downgrade" && onRollback ? (
            <button
              type="button"
              className={styles.action}
              onClick={onRollback}
              data-testid="version-rollback"
            >
              回滚
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
