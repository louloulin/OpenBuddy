import type { EmailAddress } from "@/lib/agent/pi-client";

/**
 * Generate initials (1-2 characters) for a sender avatar.
 * Returns the first non-empty character of the display name,
 * or the local-part of the email address as a fallback.
 */
export function senderInitials(sender: EmailAddress | { address: string; name?: string }): string {
  const name = (sender.name ?? "").trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  const address = sender.address.trim();
  if (!address) return "?";
  const local = address.split("@")[0] ?? address;
  return (local.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
}

/**
 * Stable color hue (0-359) for a sender avatar background.
 * Same sender → same color across sessions.
 */
export function senderHue(sender: EmailAddress | { address: string; name?: string }): number {
  const key = (sender.address || sender.name || "").toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export interface SenderAvatarStyle {
  initials: string;
  background: string;
}

/**
 * Compute avatar display: initials text + CSS gradient string.
 * Used by thread rows and contact lists to give each sender a stable visual.
 */
export function senderAvatar(sender: EmailAddress | { address: string; name?: string }, palette: "macro" | "muted" = "macro"): SenderAvatarStyle {
  const initials = senderInitials(sender);
  const hue = senderHue(sender);
  const accent = (hue + 30) % 360;
  if (palette === "muted") {
    return {
      initials,
      background: `linear-gradient(135deg, hsl(${hue}, 22%, 52%), hsl(${accent}, 22%, 42%))`,
    };
  }
  return {
    initials,
    background: `linear-gradient(135deg, hsl(${hue}, 60%, 56%), hsl(${accent}, 60%, 46%))`,
  };
}
