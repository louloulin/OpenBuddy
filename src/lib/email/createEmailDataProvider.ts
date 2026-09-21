/**
 * createEmailDataProvider — 把 capability-email IPC 转成 ui-email 的 EmailDataProvider。
 *
 * R92 fix:之前 `PlaceholderPage` 把 capability-email 的 bindings(createDefaultEmailAiBindings)
 * 注入到 EmailAiPanel 作为 runtime,但没有把 data fetching(accounts / threads / counts / triage)
 * 也注入。EmailAiPanel 在生产链路里总是渲染空态 — listbox 显示 "没有匹配的邮件"。
 *
 * 修复:本工厂把 capability-email 的 IPC 客户端包装成 `EmailDataProvider`,让
 *      EmailAiPanel 通过 useEmailData hook 真正拉取邮件。
 *
 * 设计:
 *   - 4 个方法对应 4 个 capability-email IPC channel:
 *     - listAccounts  ← email:accounts
 *     - listThreads  ← email:threads
 *     - counts       ← 用 listThreads + 启发式统计(没有专门的 counts IPC)
 *     - triage       ← email:triage(把 triage result 转成 Record<threadId, chips>)
 *
 *   - 不依赖 capability-email 之外的 layer;不需要 new IPC。
 *   - 全部稳定引用 — useMemo 友好。
 *
 * 测试:
 *   - src/lib/email/__tests__/createEmailDataProvider.test.ts(注入 mock client)
 */
import {
  emailListAccounts,
  emailListThreads,
  emailTriage,
  type EmailAccount,
  type EmailSearchInput,
  type EmailThreadPreview,
  type EmailTriageSnapshot,
} from "@/lib/agent/pi-client-email";
import type { EmailDataProvider } from "@openbuddy/ui-email/ai";
import type { AiInboxAccount, AiInboxThread, RailCounts } from "@openbuddy/ui-email/ai";

export interface CreateEmailDataProviderOptions {
  /** 默认账户 id — fallback 当 listAccounts 返回空时使用。 */
  defaultAccountId?: string;
  /** 测试 / Storybook 用:注入 mock client。 */
  client?: {
    listAccounts?: () => Promise<EmailAccount[]>;
    listThreads?: (input?: EmailSearchInput) => Promise<EmailThreadPreview[]>;
    triage?: (input?: EmailSearchInput) => Promise<EmailTriageSnapshot>;
  };
}

const SUGGESTION_TO_CHIP: Record<string, "priority" | "reply" | "action" | "muted"> = {
  priority: "priority",
  reply: "reply",
  action: "action",
  noise: "muted",
  muted: "muted",
  meeting: "action",
  fyi: "muted",
};

const EMPTY_COUNTS: RailCounts = {
  today: 0,
  later: 0,
  done: 0,
  inbox: 0,
  drafts: 0,
  scheduled: 0,
  snoozed: 0,
};

export function createEmailDataProvider(
  options: CreateEmailDataProviderOptions = {},
): EmailDataProvider {
  const client = options.client ?? {};
  const listAccountsFn = client.listAccounts ?? emailListAccounts;
  const listThreadsFn = client.listThreads ?? emailListThreads;
  const triageFn = client.triage ?? emailTriage;

  return {
    async listAccounts(): Promise<AiInboxAccount[]> {
      try {
        const raw = await listAccountsFn();
        if (!Array.isArray(raw) || raw.length === 0) {
          // 没有连接账户 — 返回空数组,UI 显示 "连接邮箱" 提示。
          return [];
        }
        return raw.map((a) => ({
          id: a.id,
          address: a.address,
          name: a.name,
          status: a.status,
        }));
      } catch {
        // 出错时给一个 "self" 兜底账户,避免 UI 完全空。
        if (options.defaultAccountId) {
          return [
            {
              id: options.defaultAccountId,
              address: `${options.defaultAccountId}@openbuddy.local`,
              name: options.defaultAccountId,
              status: "disconnected" as const,
            },
          ];
        }
        return [];
      }
    },

    async listThreads(filters): Promise<AiInboxThread[]> {
      try {
        const searchInput: EmailSearchInput = {
          ...(filters.accountId ? { accountId: filters.accountId } : {}),
          ...(filters.folder ? { folder: filters.folder as never } : {}),
          ...(filters.unreadOnly !== undefined ? { unread: filters.unreadOnly } : {}),
        };
        const raw = await listThreadsFn(searchInput);
        if (!Array.isArray(raw)) return [];
        return raw.map((t) => ({
          id: t.id,
          accountId: t.accountId,
          subject: t.subject,
          from: t.from,
          date: t.date,
          snippet: t.snippet,
          unread: (t as { unread?: boolean }).unread ?? false,
          messageCount: t.messageCount,
          labels: (t as { labels?: string[] }).labels ?? [],
        }));
      } catch {
        return [];
      }
    },

    /**
     * counts 派生 — capability-email 没有专门 IPC。
     * 启发式:对 inbox / sent / drafts / snoozed 各拉一次列表,数长度。
     * 这是 lightweight 方案;后续如果 capability-email 加 counts channel,
     * 直接替换实现即可。
     */
    async counts(): Promise<RailCounts> {
      try {
        const inputs: Array<Promise<EmailThreadPreview[]>> = [
          listThreadsFn({ folder: "inbox" as never }),
          listThreadsFn({ folder: "sent" as never }),
          listThreadsFn({ folder: "drafts" as never }),
          listThreadsFn({ folder: "snoozed" as never }),
        ];
        const [inbox, sent, drafts, snoozed] = await Promise.all(inputs);
        const safe = (arr: unknown) => (Array.isArray(arr) ? arr.length : 0);
        return {
          today: 0,
          later: 0,
          done: 0,
          inbox: safe(inbox),
          drafts: safe(drafts),
          scheduled: safe(sent),
          snoozed: safe(snoozed),
        };
      } catch {
        return EMPTY_COUNTS;
      }
    },

    /** triage:把 EmailTriageSnapshot 转成 Record<threadId, chips[]>。 */
    async triage(input): Promise<Record<string, Array<"priority" | "reply" | "action" | "muted">>> {
      try {
        const snapshot = await triageFn({
          ...(input?.accountId ? { accountId: input.accountId } : {}),
        });
        const out: Record<string, Array<"priority" | "reply" | "action" | "muted">> = {};
        if (!snapshot || !Array.isArray(snapshot.suggestions)) return out;
        for (const s of snapshot.suggestions) {
          const chip = SUGGESTION_TO_CHIP[s.category ?? ""] ?? "priority";
          out[s.threadId] = [chip];
        }
        return out;
      } catch {
        return {};
      }
    },
  };
}
