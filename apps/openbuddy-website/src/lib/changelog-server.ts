import fs from 'fs';
import path from 'path';
import type { Locale } from './i18n';

/**
 * changelog-server.ts —— 解析仓库根的 CHANGELOG.md / CHANGELOG.zh-CN.md。
 * 客户端组件请勿引用(避免 webpack 把 node:fs 打入 client bundle)。
 */

const REPO_ROOT = path.join(process.cwd(), '..', '..');

const FILE_FOR_LOCALE: Record<Locale, string> = {
  en: 'CHANGELOG.md',
  'zh-CN': 'CHANGELOG.zh-CN.md'
};

export interface ChangelogRelease {
  version: string;
  date: string;
  /** 'stable' / 'beta' / 'alpha' / 'lts' — derived from version suffix or fallback */
  tag: 'stable' | 'beta' | 'alpha' | 'lts';
  highlights: string[];
  improvements?: string[];
  fixes?: string[];
  githubHref: string;
}

/** `### v0.16.0 (2026-09-22) — Title` (en) OR `## v0.16.0（2026-09-22）· Title` (zh-CN) */
const RELEASE_RE_EN = /^###\s+(v\S+)\s+\(([^)]+)\)\s*[—–-]+\s*(.*)$/;
const RELEASE_RE_ZH = /^##\s+(v\S+)\s*[（(]([^)）]+)[)）]\s*[·•\-—–]+\s*(.*)$/;

/** `#### 🎯 Title` (en) OR `### 🎯 Title` (zh-CN) */
const SECTION_RE_EN = /^####\s+(.+)$/;
const SECTION_RE_ZH = /^###\s+(?!v)(.+)$/;

const BULLET_RE = /^\s*-\s+(.+)$/;

/** Strip surrounding ** bold and trailing colon, return clean text. */
function cleanBullet(raw: string): string {
  return raw
    .replace(/\*\*([^*]+)\*\*[—–\-:]*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/** Returns at most `max` cleaned bullets from a flat section. */
function collectBullets(lines: string[], startIdx: number): { items: string[]; endIdx: number } {
  const items: string[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (SECTION_RE_EN.test(line) || SECTION_RE_ZH.test(line) || RELEASE_RE_EN.test(line) || RELEASE_RE_ZH.test(line)) {
      break;
    }
    const m = line.match(BULLET_RE);
    if (m) items.push(cleanBullet(m[1]));
    i++;
  }
  return { items, endIdx: i };
}

function detectTag(version: string): 'stable' | 'beta' | 'alpha' | 'lts' {
  if (/-lts\./i.test(version)) return 'lts';
  if (/-beta\./i.test(version)) return 'beta';
  if (/-alpha\./i.test(version)) return 'alpha';
  return 'stable';
}

export function getChangelogReleases(locale: Locale): ChangelogRelease[] {
  const file = path.join(REPO_ROOT, FILE_FOR_LOCALE[locale]);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }

  const isZh = locale === 'zh-CN';
  const releaseRe = isZh ? RELEASE_RE_ZH : RELEASE_RE_EN;
  const sectionRe = isZh ? SECTION_RE_ZH : SECTION_RE_EN;

  const lines = raw.split('\n');
  const releases: ChangelogRelease[] = [];
  let i = 0;

  while (i < lines.length) {
    const m = lines[i].match(releaseRe);
    if (!m) {
      i++;
      continue;
    }

    const [, version, date, title] = m;
    i++;

    const highlights: string[] = [];
    const improvements: string[] = [];

    while (i < lines.length) {
      // Stop if next release begins
      if (releaseRe.test(lines[i])) break;
      // New section starts → collect its bullets
      if (sectionRe.test(lines[i])) {
        const sectionTitle = lines[i].match(sectionRe)?.[1] ?? '';
        const { items, endIdx } = collectBullets(lines, i + 1);
        i = endIdx;

        const isQualitySection = /Quality|质量|quality/i.test(sectionTitle);
        const isFirstSection = highlights.length === 0 && improvements.length === 0;

        if (isFirstSection) {
          highlights.push(...items.slice(0, 6));
        } else if (isQualitySection) {
          // Drop pure quality/test count lines from the visible highlights — they're metadata
          improvements.push(...items.slice(0, 3));
        } else {
          improvements.push(...items.slice(0, 4));
        }
        continue;
      }
      i++;
    }

    releases.push({
      version,
      date,
      tag: detectTag(version),
      highlights: highlights.length > 0 ? highlights : improvements.splice(0, 5),
      improvements: improvements.length > 0 ? improvements : undefined,
      githubHref: `https://github.com/louloulin/OpenBuddy/releases/tag/${version}`
    });
  }

  return releases;
}