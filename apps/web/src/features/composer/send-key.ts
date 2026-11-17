/** 发送键偏好 (20261116-pii W6.3): Enter 发送（默认）或 Ctrl/Cmd+Enter 发送。 */
export type SendKey = "enter" | "mod+enter";

const KEY = "openbuddy.sendKey";

export function getSendKey(): SendKey {
  try {
    return localStorage.getItem(KEY) === "mod+enter" ? "mod+enter" : "enter";
  } catch {
    return "enter";
  }
}

export function setSendKey(value: SendKey) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* storage may be unavailable */
  }
}
