/**
 * 通知渠道 —— 20261116-pii W4.6：发送已从渲染层挪到主进程。
 *
 * 载荷构造与类型是纯函数，现在住在 `@openbuddy/protocol/notifications`（渲染层与
 * `services/src/notifications/channels.ts` 共用同一份）；这里保留 re-export，
 * 让既有 import 路径继续可用。渠道的增删改查与实际发送由宿主命令
 * `notify_channels_list / save / delete / test` 承担（见 `client/api/notifications.ts`）。
 */
export {
  buildDiscordPayload,
  buildGenericPayload,
  buildMailtoUrl,
  buildPayload,
  buildSlackPayload,
  CHANNEL_KIND_LABELS,
  type ChannelKind,
  type DiscordPayload,
  type NotifyChannel,
  type NotifyChannelDraft,
  type NotifyLevel,
  type NotifyMessage,
  type NotifyResult,
  type SlackPayload,
} from "@openbuddy/protocol/notifications";
