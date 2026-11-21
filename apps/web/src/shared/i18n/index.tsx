/**
 * 界面语言 (B4): zh-CN 默认，en-US 首选覆盖设置页（导航、通用、关于、数据管理）。
 *
 * The table is intentionally flat and small: untranslated keys fall back to zh-CN, so a panel
 * can be migrated incrementally without ever rendering a raw key. `useLocale` re-renders on
 * change; the choice lives in localStorage and is mirrored to `<html lang>`.
 */
import { useSyncExternalStore } from "react";

export type Locale = "zh-CN" | "en-US";
const STORAGE_KEY = "openbuddy.locale";
const listeners = new Set<() => void>();

import { coreZh, coreEn } from "./dicts/core";
import { generalZh, generalEn } from "./dicts/general";
import { aboutZh, aboutEn } from "./dicts/about";
import { dataZh, dataEn } from "./dicts/data";
import { modelsZh, modelsEn } from "./dicts/models";
import { agentZh, agentEn } from "./dicts/agent";
import { securityZh, securityEn } from "./dicts/security";
import { mailZh, mailEn } from "./dicts/mail";
import { assistantZh, assistantEn } from "./dicts/assistant";
import { mobileZh, mobileEn } from "./dicts/mobile";
import { miscZh, miscEn } from "./dicts/misc";

/** zh-CN 是权威默认：任何缺失的 en-US 键都回落到这里。 */
const ZH: Record<string, string> = {
  ...coreZh, ...generalZh, ...aboutZh, ...dataZh,
  ...modelsZh, ...agentZh, ...securityZh, ...mailZh, ...assistantZh, ...mobileZh, ...miscZh,
};

const EN: Record<string, string> = {
  ...coreEn, ...generalEn, ...aboutEn, ...dataEn,
  ...modelsEn, ...agentEn, ...securityEn, ...mailEn, ...assistantEn, ...mobileEn, ...miscEn,
};

const DICTS: Record<Locale, Record<string, string>> = { "zh-CN": ZH, "en-US": EN };

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "en-US" ? "en-US" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

let current: Locale = readLocale();

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode: the language still applies for this session.
  }
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Translate a key in the active locale; unknown keys fall back to zh-CN, then to the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const text = DICTS[current][key] ?? ZH[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** The translation when it exists, otherwise undefined (lets a component keep its own default). */
export function tOptional(key: string): string | undefined {
  return DICTS[current][key] ?? ZH[key];
}

/** Apply `<html lang>` on boot (main.tsx). */
export function applyLocale(): void {
  document.documentElement.lang = current;
}

export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, setLocale, t, tOptional };
}
