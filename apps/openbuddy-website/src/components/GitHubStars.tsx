'use client';

import { useState, useEffect } from 'react';
import { Github, Star } from 'lucide-react';

interface GitHubStarsProps {
  /** 仓库 owner/name (e.g. louloulin/OpenBuddy) */
  repo: string;
  /** 显示在数字旁边的格式化 (e.g. 12.8k). */
  fallback?: string;
  /** 紧凑模式 (只显示数字，无边框背景) */
  compact?: boolean;
}

/**
 * GitHubStars —— 实时获取仓库 star 数 (免 token)
 *
 * 使用 GitHub 公开 API: GET /repos/{owner}/{repo}
 * 失败时回退到 `fallback` (例如 `12.8k`)。
 *
 * Cache 策略：
 * - localStorage 缓存 1 小时，避免每次渲染都请求
 * - 组件挂载时后台拉取新数据
 */
export default function GitHubStars({ repo, fallback = '12.8k', compact = false }: GitHubStarsProps) {
  const [count, setCount] = useState<string | null>(null);

  useEffect(() => {
    const CACHE_KEY = `ob:gh-stars:${repo}`;
    const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { value, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL_MS) {
          setCount(value);
        }
      }
    } catch {
      // ignore
    }

    fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.stargazers_count != null) {
          const formatted = formatStars(data.stargazers_count);
          setCount(formatted);
          try {
            localStorage.setItem(
              CACHE_KEY,
              JSON.stringify({ value: formatted, ts: Date.now() })
            );
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // 失败时保持 fallback
        setCount((c) => c ?? fallback);
      });
  }, [repo, fallback]);

  const display = count ?? fallback;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums">
        <Star className="h-3 w-3 fill-current" />
        <span>{ display }</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
      <Star className="h-3 w-3 fill-current" />
      <span>{ display }</span>
    </span>
  );
}

/**
 * formatStars —— 格式化 star 数为 '12.8k' / '1.2M' 形式
 */
function formatStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}