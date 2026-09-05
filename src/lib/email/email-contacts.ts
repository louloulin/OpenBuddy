import type { EmailAddress, EmailThread, EmailThreadPreview } from "@/lib/agent/pi-client";

export interface EmailContact {
  address: string;
  name?: string;
  accountIds: string[];
  lastContactedAt?: string;
  interactionCount: number;
}

function validAddress(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

function contactSources(thread: EmailThread | EmailThreadPreview): Array<{ accountId: string; date?: string; addresses: EmailAddress[] }> {
  if ("messages" in thread) {
    return thread.messages.map((message) => ({
      accountId: thread.accountId,
      date: message.date,
      addresses: [message.from, ...message.to, ...message.cc, ...(message.bcc ?? []), ...(message.replyTo ?? [])],
    }));
  }
  return [{ accountId: thread.accountId, date: thread.date, addresses: [thread.from] }];
}

export function collectEmailContacts(
  threads: readonly (EmailThread | EmailThreadPreview)[],
  excludedAddresses: readonly string[] = [],
): EmailContact[] {
  const excluded = new Set(excludedAddresses.map((address) => address.trim().toLowerCase()).filter(Boolean));
  const contacts = new Map<string, EmailContact>();
  for (const thread of threads) {
    for (const source of contactSources(thread)) {
      for (const entry of source.addresses) {
        const address = entry.address.trim();
        const key = address.toLowerCase();
        if (!validAddress(address) || excluded.has(key)) continue;
        const current = contacts.get(key);
        const next: EmailContact = current ?? { address, accountIds: [], interactionCount: 0 };
        if (entry.name?.trim() && !next.name) next.name = entry.name.trim();
        if (!next.accountIds.includes(source.accountId)) next.accountIds.push(source.accountId);
        next.interactionCount += 1;
        if (!next.lastContactedAt || (source.date && Date.parse(source.date) > Date.parse(next.lastContactedAt))) next.lastContactedAt = source.date;
        contacts.set(key, next);
      }
    }
  }
  return [...contacts.values()].sort((left, right) => {
    const dateDelta = Date.parse(right.lastContactedAt ?? "") - Date.parse(left.lastContactedAt ?? "");
    if (Number.isFinite(dateDelta) && dateDelta !== 0) return dateDelta;
    if (right.interactionCount !== left.interactionCount) return right.interactionCount - left.interactionCount;
    return (left.name ?? left.address).localeCompare(right.name ?? right.address, "zh-CN");
  });
}

export function filterEmailContacts(contacts: readonly EmailContact[], query: string, limit = 8): EmailContact[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return contacts.slice(0, limit);
  return contacts.filter((contact) => `${contact.name ?? ""} ${contact.address}`.toLocaleLowerCase().includes(normalized)).slice(0, limit);
}
