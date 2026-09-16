import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Composer } from "@openbuddy/ui-conversation";

import type { ModelOption } from "@openbuddy/ui-workbench";
import type { WorkspaceInfo } from "@/lib/agent/pi-client";
import type { AgentEntry } from "@openbuddy/shared-types";
import { MoreIcon, SparklesIcon, CloseIcon } from "@openbuddy/ui-primitives/icons";
import { useHorizontalScroll } from "@openbuddy/ui-shared";
import { Skeleton } from "@openbuddy/ui-primitives";
import { useSessionsStore, HOME_DRAFT_KEY } from "@/stores/sessions-store";
import { useRendererSlot } from "@/lib/runtime/renderer-plugin-runtime";
import { useSlotPayloads } from "@openbuddy/ui-runtime/client";
import { HomePracticeCases, HomeSceneTabs } from "./home-slots";
import { RendererSlotView } from "@openbuddy/ui-workbench";
import { usePendingExpertStore } from "@/stores/pending-expert-store";
import {
  HOME_MODES,
  getMode,
  type HomeCategory,
  type HomeModeId,
  type HomeTemplate,
} from "@openbuddy/ui-shared";

/** 未展开时,能力 chip 行最多显示几个(超出折叠为"更多")。与 home-scenes 保持一致(7 = WorkBuddy 日常办公场景下的完整 chip 数)。 */
const COLLAPSED_VISIBLE_COUNT = 7;

/** 模板 chip 右侧的 ↘ 斜箭头(复刻 WorkBuddy 的 quick-actions-sub 箭头)。 */
function ArrowRightSubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <g transform="translate(0 14) scale(1 -1)">
        <path
          fill="currentColor"
          fillRule="evenodd"
          transform="matrix(1 0 0 1 2.25385 2.09996)"
          d="M8.5963 5.775L8.5963 3.9772Q8.5963 2.6005 8.537 2.1664Q8.5175 2.0232 8.4867 1.9021L0.7425 9.6463L0 8.9038L7.7442 1.1596Q7.6231 1.1288 7.4799 1.1092Q7.0458 1.05 5.6691 1.05L3.8712 1.05L3.8712 0.0001L5.669 0.0001Q7.1171 0 7.6219 0.0689Q8.5026 0.1891 8.9799 0.6664Q9.4572 1.1437 9.5774 2.0244Q9.6463 2.5292 9.6462 3.9773L9.6462 5.775L8.5963 5.775Z"
        />
      </g>
    </svg>
  );
}

/** 最佳实践案例"换一批"按钮上的刷新图标。 */
function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

/** Phase 4 — 技能推荐 chips *//**
 * 案例卡 SVG 缩略图 —— 内联可矢量渲染,不引入外部资源。
 * 设计目标:复刻 WorkBuddy 案例卡那种"看起来像真实业务界面"的视觉密度,
 * 每张 mock 包含一个标题条 + 2~3 个内容形状(KPI/段落/图表/层叠卡)。
 */
function PracticeThumbDashboard() {
  /* 「本月经营复盘报告」:  KPI 卡 (营收/新客/转化) + 趋势 sparkline + 渠道饼条
   * 比上一版多 30+ 元素, 视觉密度接近真实 BI 仪表盘缩略图。 */
  return (
    <svg viewBox="0 0 234 121" role="img" aria-label="本月经营复盘报告">
      <rect width="234" height="121" fill="#F4F8FE" />
      {/* 顶部标题栏 */}
      <rect x="10" y="10" width="6" height="14" rx="1" fill="#3B5BDB" />
      <rect x="20" y="11" width="58" height="5" rx="2" fill="#0F1B36" opacity=".8" />
      <rect x="20" y="19" width="36" height="3" rx="1.5" fill="#0F1B36" opacity=".35" />
      <rect x="200" y="12" width="20" height="8" rx="3" fill="#3B5BDB" opacity=".12" />
      <rect x="204" y="15" width="12" height="2" rx="1" fill="#3B5BDB" />
      {/* 三张 KPI 卡 */}
      <g transform="translate(10 32)">
        <rect width="68" height="38" rx="5" fill="#fff" stroke="#E0E8F8" />
        <rect x="6" y="6" width="20" height="2.5" rx="1" fill="#0F1B36" opacity=".5" />
        <rect x="6" y="12" width="40" height="7" rx="1.5" fill="#0F1B36" />
        <rect x="6" y="22" width="14" height="3" rx="1" fill="#3B5BDB" />
        <rect x="22" y="22" width="32" height="3" rx="1" fill="#0F1B36" opacity=".18" />
        <g transform="translate(48 27)" stroke="#3B5BDB" strokeWidth="1" fill="none">
          <polyline points="0,6 4,3 8,5 12,1 16,2" />
        </g>
      </g>
      <g transform="translate(83 32)">
        <rect width="68" height="38" rx="5" fill="#fff" stroke="#E0E8F8" />
        <rect x="6" y="6" width="20" height="2.5" rx="1" fill="#0F1B36" opacity=".5" />
        <rect x="6" y="12" width="34" height="7" rx="1.5" fill="#0F1B36" />
        <rect x="6" y="22" width="14" height="3" rx="1" fill="#1F9D55" />
        <rect x="22" y="22" width="32" height="3" rx="1" fill="#0F1B36" opacity=".18" />
        <g transform="translate(48 27)" stroke="#1F9D55" strokeWidth="1" fill="none">
          <polyline points="0,5 4,3 8,4 12,2 16,0" />
        </g>
      </g>
      <g transform="translate(156 32)">
        <rect width="68" height="38" rx="5" fill="#fff" stroke="#E0E8F8" />
        <rect x="6" y="6" width="20" height="2.5" rx="1" fill="#0F1B36" opacity=".5" />
        <rect x="6" y="12" width="42" height="7" rx="1.5" fill="#0F1B36" />
        <rect x="6" y="22" width="14" height="3" rx="1" fill="#E03131" />
        <rect x="22" y="22" width="32" height="3" rx="1" fill="#0F1B36" opacity=".18" />
        <g transform="translate(48 27)" stroke="#E03131" strokeWidth="1" fill="none">
          <polyline points="0,2 4,4 8,3 12,5 16,6" />
        </g>
      </g>
      {/* 主图: 折线 + 渐变填充 */}
      <g transform="translate(10 76)">
        <rect width="214" height="38" rx="5" fill="#fff" stroke="#E0E8F8" />
        <rect x="6" y="5" width="36" height="2.5" rx="1" fill="#0F1B36" opacity=".6" />
        <rect x="6" y="10" width="22" height="2" rx="1" fill="#0F1B36" opacity=".28" />
        <path d="M6 32 L24 26 L42 28 L60 18 L78 22 L96 12 L114 16 L132 8 L150 14 L168 6 L186 10 L204 4" stroke="#3B5BDB" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 32 L24 26 L42 28 L60 18 L78 22 L96 12 L114 16 L132 8 L150 14 L168 6 L186 10 L204 4 L204 36 L6 36 Z" fill="#3B5BDB" opacity=".07" />
        <g fill="#3B5BDB">
          <circle cx="60" cy="18" r="1.4" />
          <circle cx="132" cy="8" r="1.4" />
          <circle cx="204" cy="4" r="1.4" />
        </g>
      </g>
    </svg>
  );
}

function PracticeThumbDocument() {
  /* 「公众号创刊推文」: 顶部题图 + 多段正文 + 配图占位 + 标签云
   * 元素数 50+, 视觉密度接近真实推文排版预览。 */
  return (
    <svg viewBox="0 0 234 121" role="img" aria-label="公众号创刊推文从选题到成稿">
      <rect width="234" height="121" fill="#FFF7EE" />
      {/* 题图占位 */}
      <rect x="14" y="10" width="206" height="22" rx="3" fill="#E8D7C0" opacity=".55" />
      <circle cx="32" cy="21" r="5" fill="#B8501A" opacity=".6" />
      <rect x="44" y="18" width="60" height="2.5" rx="1" fill="#0F1B36" opacity=".5" />
      <rect x="44" y="23" width="42" height="2" rx="1" fill="#0F1B36" opacity=".3" />
      <rect x="184" y="16" width="22" height="10" rx="2" fill="#B8501A" opacity=".2" />
      {/* 标题 */}
      <rect x="14" y="40" width="180" height="6" rx="2" fill="#0F1B36" opacity=".85" />
      <rect x="14" y="50" width="120" height="3.5" rx="1.5" fill="#0F1B36" opacity=".5" />
      {/* 正文段落 (3 行, 错位长度模拟真实文本流) */}
      <g transform="translate(14 62)" fill="#0F1B36" opacity=".55">
        <rect width="206" height="2.5" rx="1" />
        <rect y="6" width="186" height="2.5" rx="1" />
        <rect y="12" width="200" height="2.5" rx="1" />
        <rect y="18" width="158" height="2.5" rx="1" />
        <rect y="24" width="176" height="2.5" rx="1" />
      </g>
      {/* 标签云 + 操作按钮 */}
      <g transform="translate(14 96)">
        <rect width="38" height="14" rx="7" fill="#B8501A" opacity=".18" />
        <rect x="6" y="5" width="26" height="3" rx="1.5" fill="#B8501A" />
        <rect x="44" width="34" height="14" rx="7" fill="#fff" stroke="#E8D7C0" />
        <rect x="50" y="5" width="22" height="3" rx="1.5" fill="#0F1B36" opacity=".5" />
        <rect x="84" width="28" height="14" rx="7" fill="#fff" stroke="#E8D7C0" />
        <rect x="90" y="5" width="16" height="3" rx="1.5" fill="#0F1B36" opacity=".5" />
        <rect x="180" y="1" width="24" height="12" rx="3" fill="#B8501A" />
        <rect x="186" y="5" width="12" height="3" rx="1.5" fill="#fff" />
      </g>
    </svg>
  );
}

function PracticeThumbAnalytics() {
  /* 「销售数据分析仪表盘」: 双折线 (实际 vs 目标) + 柱状 (各渠道) + 数字标签
   * 模拟 BI 工具的多图层可视化, 元素数 40+, 接近真实销售分析页缩略图。 */
  return (
    <svg viewBox="0 0 234 121" role="img" aria-label="销售数据分析仪表盘">
      <rect width="234" height="121" fill="#F2FAF4" />
      {/* 标题 + 筛选器 */}
      <rect x="12" y="12" width="60" height="5" rx="2" fill="#0F1B36" opacity=".8" />
      <rect x="12" y="21" width="38" height="3" rx="1.5" fill="#0F1B36" opacity=".35" />
      <rect x="170" y="14" width="22" height="8" rx="3" fill="#fff" stroke="#DDEEDC" />
      <rect x="174" y="17" width="14" height="2" rx="1" fill="#0F1B36" opacity=".5" />
      <rect x="196" y="14" width="22" height="8" rx="3" fill="#1F9D55" />
      <rect x="200" y="17" width="14" height="2" rx="1" fill="#fff" />
      {/* 左侧柱状图: 各渠道销售 */}
      <g transform="translate(12 32)">
        <rect width="86" height="62" rx="5" fill="#fff" stroke="#DDEEDC" />
        <rect x="6" y="4" width="28" height="2.5" rx="1" fill="#0F1B36" opacity=".55" />
        {/* y 轴网格线 */}
        <line x1="6" y1="50" x2="80" y2="50" stroke="#DDEEDC" strokeWidth=".5" />
        <line x1="6" y1="40" x2="80" y2="40" stroke="#DDEEDC" strokeWidth=".5" />
        <line x1="6" y1="30" x2="80" y2="30" stroke="#DDEEDC" strokeWidth=".5" />
        {/* 柱子 */}
        <g transform="translate(10 14)">
          <rect width="6" height="36" rx="1" fill="#1F9D55" opacity=".85" />
          <rect x="9" width="6" height="22" rx="1" fill="#1F9D55" opacity=".7" />
          <rect x="18" width="6" height="30" rx="1" fill="#1F9D55" opacity=".85" />
          <rect x="27" width="6" height="18" rx="1" fill="#1F9D55" opacity=".55" />
          <rect x="36" width="6" height="28" rx="1" fill="#1F9D55" opacity=".85" />
          <rect x="45" width="6" height="34" rx="1" fill="#1F9D55" opacity=".85" />
          <rect x="54" width="6" height="14" rx="1" fill="#1F9D55" opacity=".55" />
        </g>
      </g>
      {/* 右侧折线图: 实际 vs 目标 */}
      <g transform="translate(104 32)">
        <rect width="118" height="62" rx="5" fill="#fff" stroke="#DDEEDC" />
        <rect x="6" y="4" width="32" height="2.5" rx="1" fill="#0F1B36" opacity=".55" />
        {/* 图例 */}
        <rect x="58" y="4" width="6" height="2.5" rx="1" fill="#1F9D55" />
        <rect x="66" y="4" width="14" height="2.5" rx="1" fill="#0F1B36" opacity=".4" />
        <rect x="86" y="4" width="6" height="2.5" rx="1" fill="#E03131" opacity=".55" />
        <rect x="94" y="4" width="14" height="2.5" rx="1" fill="#0F1B36" opacity=".4" />
        {/* 网格 */}
        <line x1="6" y1="50" x2="112" y2="50" stroke="#DDEEDC" strokeWidth=".5" />
        <line x1="6" y1="38" x2="112" y2="38" stroke="#DDEEDC" strokeWidth=".5" />
        <line x1="6" y1="26" x2="112" y2="26" stroke="#DDEEDC" strokeWidth=".5" />
        {/* 实际线 (绿色实线) */}
        <polyline points="10,46 28,32 46,36 64,22 82,28 100,14 108,18" fill="none" stroke="#1F9D55" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* 目标线 (红色虚线) */}
        <polyline points="10,40 28,30 46,28 64,20 82,18 100,10 108,8" fill="none" stroke="#E03131" strokeWidth="1.2" strokeOpacity=".55" strokeDasharray="2 2" />
        <g fill="#1F9D55">
          <circle cx="28" cy="32" r="1.6" />
          <circle cx="64" cy="22" r="1.6" />
          <circle cx="100" cy="14" r="1.6" />
        </g>
        <g fill="#E03131" opacity=".65">
          <circle cx="64" cy="20" r="1.4" />
          <circle cx="100" cy="10" r="1.4" />
        </g>
      </g>
      {/* 底部时间轴标签 */}
      <g transform="translate(12 100)" fill="#0F1B36" opacity=".4">
        <rect width="8" height="2" rx="1" />
        <rect x="20" width="8" height="2" rx="1" />
        <rect x="40" width="8" height="2" rx="1" />
        <rect x="60" width="8" height="2" rx="1" />
        <rect x="80" width="8" height="2" rx="1" />
        <rect x="100" width="8" height="2" rx="1" />
        <rect x="120" width="8" height="2" rx="1" />
      </g>
    </svg>
  );
}

function PracticeThumbNarrative() {
  /* 「交互式滚动叙事页」: 时间轴 + 多章节卡片 + 进度指示器
   * 模拟 longform 编辑器的大纲视图, 元素数 40+, 类似 Notion / 飞书文档多节预览。 */
  return (
    <svg viewBox="0 0 234 121" role="img" aria-label="交互式滚动叙事页">
      <rect width="234" height="121" fill="#F8F4FE" />
      {/* 标题 */}
      <rect x="12" y="12" width="58" height="5" rx="2" fill="#0F1B36" opacity=".8" />
      <rect x="12" y="21" width="36" height="3" rx="1.5" fill="#0F1B36" opacity=".35" />
      <rect x="180" y="14" width="40" height="8" rx="3" fill="#6B38C9" />
      <rect x="186" y="17" width="28" height="2" rx="1" fill="#fff" />
      {/* 章节 1: 开场 (高亮) */}
      <g transform="translate(12 32)">
        <rect width="210" height="20" rx="5" fill="#6B38C9" opacity=".12" />
        <rect width="3" height="20" rx="1" fill="#6B38C9" />
        <circle cx="14" cy="10" r="3" fill="#6B38C9" />
        <rect x="22" y="6" width="48" height="3" rx="1.5" fill="#0F1B36" opacity=".75" />
        <rect x="22" y="12" width="120" height="2.5" rx="1" fill="#0F1B36" opacity=".35" />
        <rect x="190" y="6" width="14" height="8" rx="2" fill="#6B38C9" opacity=".25" />
      </g>
      {/* 章节 2: 展开 */}
      <g transform="translate(12 56)">
        <rect width="210" height="20" rx="5" fill="#fff" stroke="#E5D8F8" />
        <circle cx="14" cy="10" r="3" fill="#fff" stroke="#6B38C9" strokeWidth="1.2" />
        <rect x="22" y="6" width="56" height="3" rx="1.5" fill="#0F1B36" opacity=".7" />
        <rect x="22" y="12" width="140" height="2.5" rx="1" fill="#0F1B36" opacity=".3" />
        <rect x="190" y="6" width="14" height="8" rx="2" fill="#0F1B36" opacity=".08" />
      </g>
      {/* 章节 3: 迎合 */}
      <g transform="translate(12 80)">
        <rect width="210" height="20" rx="5" fill="#fff" stroke="#E5D8F8" />
        <circle cx="14" cy="10" r="3" fill="#fff" stroke="#6B38C9" strokeWidth="1.2" />
        <rect x="22" y="6" width="44" height="3" rx="1.5" fill="#0F1B36" opacity=".7" />
        <rect x="22" y="12" width="160" height="2.5" rx="1" fill="#0F1B36" opacity=".3" />
        <rect x="190" y="6" width="14" height="8" rx="2" fill="#0F1B36" opacity=".08" />
      </g>
      {/* 底部进度指示器 */}
      <g transform="translate(12 108)">
        <rect width="210" height="3" rx="1.5" fill="#E5D8F8" />
        <rect width="64" height="3" rx="1.5" fill="#6B38C9" />
        <rect x="216" y="0" width="6" height="3" rx="1.5" fill="#6B38C9" opacity=".4" />
        <rect x="80" y="-4" width="42" height="11" rx="5.5" fill="#fff" stroke="#E5D8F8" />
        <rect x="86" y="0" width="32" height="3" rx="1.5" fill="#0F1B36" opacity=".55" />
      </g>
    </svg>
  );
}

function PracticeThumbMeeting() {
  /* 「周会议纪要与待办同步」: 时间轴 (会议节段) + 待办卡片 + 头像列
   * 模拟飞书 / 钉钉会议纪要的结构, 元素数 35+, 接近真实会议纪要模板。 */
  return (
    <svg viewBox="0 0 234 121" role="img" aria-label="周会议纪要与待办同步">
      <rect width="234" height="121" fill="#EEF6FE" />
      {/* 顶部: 会议标题 + 状态 */}
      <rect x="12" y="12" width="58" height="5" rx="2" fill="#0F1B36" opacity=".8" />
      <rect x="12" y="21" width="40" height="3" rx="1.5" fill="#0F1B36" opacity=".35" />
      <g transform="translate(186 14)">
        <rect width="36" height="10" rx="5" fill="#1F9D55" opacity=".18" />
        <circle cx="6" cy="5" r="2" fill="#1F9D55" />
        <rect x="12" y="3" width="20" height="2.5" rx="1" fill="#1F9D55" />
        <rect x="12" y="6.5" width="14" height="2" rx="1" fill="#1F9D55" opacity=".5" />
      </g>
      {/* 左侧: 参会人头像列 */}
      <g transform="translate(12 36)">
        <circle cx="6" cy="6" r="6" fill="#3B5BDB" opacity=".85" />
        <circle cx="6" cy="6" r="6" fill="none" stroke="#fff" strokeWidth="1" />
        <circle cx="6" cy="22" r="6" fill="#1F9D55" opacity=".85" />
        <circle cx="6" cy="22" r="6" fill="none" stroke="#fff" strokeWidth="1" />
        <circle cx="6" cy="38" r="6" fill="#E03131" opacity=".85" />
        <circle cx="6" cy="38" r="6" fill="none" stroke="#fff" strokeWidth="1" />
        <circle cx="6" cy="54" r="6" fill="#6B38C9" opacity=".85" />
        <circle cx="6" cy="54" r="6" fill="none" stroke="#fff" strokeWidth="1" />
      </g>
      {/* 中间: 时间轴节点 */}
      <line x1="32" y1="42" x2="32" y2="96" stroke="#3B5BDB" strokeWidth="1" strokeDasharray="2 2" opacity=".4" />
      {/* 节段 1 */}
      <g transform="translate(28 36)">
        <rect width="194" height="18" rx="4" fill="#fff" stroke="#DDE6F5" />
        <rect x="10" y="5" width="40" height="2.5" rx="1" fill="#0F1B36" opacity=".7" />
        <rect x="10" y="11" width="120" height="2" rx="1" fill="#0F1B36" opacity=".3" />
        <rect x="160" y="4" width="26" height="10" rx="2" fill="#3B5BDB" opacity=".15" />
        <rect x="166" y="7" width="14" height="3" rx="1.5" fill="#3B5BDB" />
      </g>
      {/* 节段 2 (高亮, 当前) */}
      <g transform="translate(28 58)">
        <rect width="194" height="18" rx="4" fill="#3B5BDB" opacity=".08" />
        <rect x="10" y="5" width="48" height="2.5" rx="1" fill="#0F1B36" opacity=".75" />
        <rect x="10" y="11" width="100" height="2" rx="1" fill="#0F1B36" opacity=".35" />
        <rect x="160" y="4" width="26" height="10" rx="2" fill="#3B5BDB" />
        <rect x="166" y="7" width="14" height="3" rx="1.5" fill="#fff" />
      </g>
      {/* 节段 3 */}
      <g transform="translate(28 80)">
        <rect width="194" height="18" rx="4" fill="#fff" stroke="#DDE6F5" />
        <rect x="10" y="5" width="44" height="2.5" rx="1" fill="#0F1B36" opacity=".7" />
        <rect x="10" y="11" width="116" height="2" rx="1" fill="#0F1B36" opacity=".3" />
        <rect x="160" y="4" width="26" height="10" rx="2" fill="#0F1B36" opacity=".08" />
        <rect x="166" y="7" width="14" height="3" rx="1.5" fill="#0F1B36" opacity=".55" />
      </g>
      {/* 底部待办摘要 */}
      <g transform="translate(12 104)">
        <rect width="8" height="8" rx="2" fill="#0F1B36" opacity=".25" />
        <rect x="14" y="1" width="64" height="2.5" rx="1" fill="#0F1B36" opacity=".55" />
        <rect x="14" y="5" width="40" height="2" rx="1" fill="#0F1B36" opacity=".3" />
        <rect x="120" y="1" width="14" height="6" rx="3" fill="#1F9D55" opacity=".85" />
        <rect x="140" y="1" width="14" height="6" rx="3" fill="#FAB005" opacity=".85" />
        <rect x="160" y="1" width="14" height="6" rx="3" fill="#E03131" opacity=".85" />
      </g>
    </svg>
  );
}

const BEST_PRACTICES: ReadonlyArray<{
  titleZh: string;
  prompt: string;
  thumb: () => React.JSX.Element;
}> = [
  {
    titleZh: "本月经营复盘报告",
    prompt:
      "请帮我生成一份本月经营复盘: 核心指标同环比变化、TOP3 问题、下个月的 3 个重点攻坚动作。",
    thumb: PracticeThumbDashboard,
  },
  {
    titleZh: "公众号创刊推文:从选题到成稿",
    prompt:
      "请针对一个业务主题生成公众号创刊推文:选题、叙事骨架、金句与三段式正文。",
    thumb: PracticeThumbDocument,
  },
  {
    titleZh: "销售数据分析仪表盘",
    prompt:
      "请根据我的销售数据输出一份仪表盘:按月份与渠道看同环比、贡献占比、异常点检查。",
    thumb: PracticeThumbAnalytics,
  },
  {
    titleZh: "交互式滚动叙事页",
    prompt:
      "请生成一个交互式滚动叙事页的论点与节奏:开场、迎合、高潮、留白。",
    thumb: PracticeThumbNarrative,
  },
  {
    titleZh: "周会议纪要与待办同步",
    prompt:
      "请把本周的会议录音转写稿整理为结构化纪要:决议、风险、待办(负责人/截止日),并按优先级排版。",
    thumb: PracticeThumbMeeting,
  },
];

/**
 * WorkBuddy 风格首页:双行大标题 + 场景 tab + 能力 chip 行 + Composer +
 * 活动 banner + 最佳实践案例。
 *
 * 复刻 WorkBuddy 的三级交互:
 *  1. 顶部场景 tab(日常办公/代码开发/设计创意)切换下方能力 chip 列表;
 *  2. 点击能力 chip → 该分类被选中,能力行隐藏并替换为推荐模板行(↘),
 *     同时在输入框内插入一个不可编辑的黑色"操作类型"标签(× 可删);
 *  3. 点击模板 chip → 把对应 prompt 填入输入框(保留操作类型标签)。
 * 能力行支持横向滚动(左右箭头 + 边缘渐隐 + 拖拽),超出折叠为前 N 个 + "更多"。
 *
 * 全面对齐 WorkBuddy 的额外结构:
 *   - 顶部右侧 WorkBuddy 风格的"积分好礼"chip 与活动 banner 已按用户要求移除(右侧不需要)。
 *   - Composer 下方"最佳实践案例"卡片网格(4 张)
 */
export function HomePage({
  onSend,
  streaming,
  apiReady,
  onOpenSettings,
  onPlaceholder,
  modelId,
  models,
  onModelChange,
  cwd,
  workspaces,
  onSelectWorkspace,
  onSelectMode,
  onSelectExpert,
  onNavigateConnectors,
}: {
  onSend: (text: string) => void;
  streaming: boolean;
  apiReady: boolean;
  onOpenSettings: () => void;
  onPlaceholder: (label: string) => void;
  modelId?: string;
  models?: ModelOption[];
  onModelChange?: (id: string) => void;
  cwd?: string;
  workspaces?: WorkspaceInfo[];
  onSelectWorkspace?: (cwd: string) => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onNavigateConnectors?: () => void;
}) {
  const [modeId, setModeId] = useState<HomeModeId>("working");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  // 输入框内黑色"操作类型"标签。
  const [sceneTag, setSceneTag] = useState<{ label: string; icon: HomeCategory["icon"] } | null>(null);
  // 受控填充 Composer 的内容 + nonce(点模板时写入 prompt)。
  const [externalText, setExternalText] = useState("");
  const [externalTextNonce, setExternalTextNonce] = useState(0);
  // 最佳实践案例 banner 关闭状态。
  const [practicesBannerDismissed, setPracticesBannerDismissed] = useState(false);
  // 最佳实践案例刷新 nonce(下方的"换一批")。
  const [practicesNonce, setPracticesNonce] = useState(0);
  // 首页草稿(哨兵 key):用户离开首页再回来,未发送的字还在。
  const homeDraft = useSessionsStore((s) => s.drafts[HOME_DRAFT_KEY] ?? "");
  const setDraft = useSessionsStore((s) => s.setDraft);
  const workspaceHeroSlots = useRendererSlot("conversation.hero.workspace");
  const brandHeroSlots = useRendererSlot("conversation.hero.brand.mark");
  const pluginSceneTabs = useSlotPayloads<{
    id: string;
    label: string;
    icon?: React.ReactNode;
    description?: string;
    onActivate?: () => void;
  }>("home.scene.tab");

  // Pending expert (set after "召唤" in the detail modal).
  const pendingExpert = usePendingExpertStore((s) => s.expert);
  const pendingHandledRef = useRef<string | null>(null);

  // When a pending expert arrives with a quickPrompt, pre-fill the composer.
  useEffect(() => {
    if (!pendingExpert) return;
    // Only auto-fill once per expert (avoid re-filling if user clears it).
    if (pendingHandledRef.current === pendingExpert.expertId) return;
    pendingHandledRef.current = pendingExpert.expertId;
    if (pendingExpert.quickPrompt) {
      fillComposer(pendingExpert.quickPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingExpert]);

  const mode = getMode(modeId);
  const categories = mode.categories;
  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCategoryId),
    [categories, selectedCategoryId]
  );

  /** 写入 Composer 并聚焦(nonce 递增保证连续点同一模板也生效)。 */
  const fillComposer = (text: string) => {
    setExternalText(text);
    setExternalTextNonce((n) => n + 1);
  };

  const handleModeChange = (next: HomeModeId) => {
    setModeId(next);
    setSelectedCategoryId(undefined);
    setExpanded(false);
    setSceneTag(null);
  };

  const handleCategoryClick = (cat: HomeCategory) => {
    if (selectedCategoryId === cat.id) {
      setSelectedCategoryId(undefined);
      setSceneTag(null);
      return;
    }
    setSelectedCategoryId(cat.id);
    setSceneTag({ label: cat.label, icon: cat.icon });
  };

  // 点击模板 chip:把 prompt 填入输入框(保留操作类型标签)。
  const handleTemplateClick = (tpl: HomeTemplate) => {
    fillComposer(tpl.prompt);
  };

  const handleClearSceneTag = () => {
    setSceneTag(null);
    setSelectedCategoryId(undefined);
  };

  // 能力行:未选中且未展开时,折叠为前 N 个 + "更多"。
  const shouldCollapse =
    !selectedCategory && !expanded && categories.length > COLLAPSED_VISIBLE_COUNT;
  const visibleCategories = shouldCollapse
    ? categories.slice(0, COLLAPSED_VISIBLE_COUNT)
    : categories;

  const listScroll = useHorizontalScroll([
    categories.length,
    expanded,
    selectedCategoryId,
    modeId,
  ]);
  const subScroll = useHorizontalScroll([
    selectedCategoryId,
    selectedCategory?.templates.length ?? 0,
  ]);

  const sceneCls = (id: HomeModeId) =>
    "home__scene" + (modeId === id ? " home__scene--active" : "");
  const sceneTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleSceneTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const lastIndex = HOME_MODES.length - 1;
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % HOME_MODES.length;
    else if (event.key === "ArrowLeft") nextIndex = index === 0 ? lastIndex : index - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = lastIndex;
    else return;

    event.preventDefault();
    const nextTab = sceneTabRefs.current[nextIndex];
    nextTab?.focus();
    nextTab?.click();
  };

  /** 最佳实践案例 —— 对齐 WorkBuddy 的"不知道做什么，试试最佳实践案例"。 */
  const bestPractices = useMemo(() => BEST_PRACTICES, []);

  return (
    <div className="home">
      <div className="home__inner">
        <div className="home__hero">
        <header className="home__header">
          {brandHeroSlots.map((entry) => (
            <RendererSlotView key={String(entry.options.id ?? entry.options.name)} entry={entry} className="home__brand-plugin" />
          ))}
          <h1 className="home__title">
            <span className="home__title-brand">OpenBuddy</span>
            <span className="home__title-sep" aria-hidden="true">,</span>
            <span className="home__title-greet">我帮你</span>
          </h1>
          {/* R-fix: 场景副标题(你的职场超能力 / 你的开发超能力 / 你的设计超能力)
              —— 之前被 sidebar-menus.css 的 .home__subtitle{display:none} 隐藏,
              导致 HomePage.test 找不到 subtitle 文本。恢复可见并按 active scene
              动态切换。 */}
          <p className="home__subtitle" aria-live="polite">
            {mode.subtitle}
          </p>
        </header>
        {workspaceHeroSlots.map((entry) => (
          <RendererSlotView key={String(entry.options.id ?? entry.options.name)} entry={entry} className="home__workspace-plugin" />
        ))}

        {/* 场景行走内核 `home.scene-tabs` 槽 —— 插件可以整行换成自己的场景导航
            (例如按团队职责分组的入口);`fallback` 是接线前的这一行,逐字不变。 */}
        <HomeSceneTabs
          modes={HOME_MODES}
          activeMode={modeId}
          onSelect={handleModeChange}
          fallback={
            <div className="home__scenes" role="tablist" aria-label="场景">
              {HOME_MODES.map((m, index) => (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={modeId === m.id}
                  aria-controls="home-mode-panel"
                  aria-label={m.label}
                  tabIndex={modeId === m.id ? 0 : -1}
                  className={sceneCls(m.id)}
                  ref={(element) => {
                    sceneTabRefs.current[index] = element;
                  }}
                  onClick={() => handleModeChange(m.id)}
                  onKeyDown={(event) => handleSceneTabKeyDown(event, index)}
                >
                  <m.icon size={14} />
                  <span>{m.label}</span>
                </button>
              ))}
              {/* 插件贡献的场景 tab（`home.scene.tab` slot）。
                  数据型贡献只提供描述，UI 由宿主渲染 —— 第三方插件因此不必打包 React。 */}
              {pluginSceneTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={false}
                  className="home__scene home__scene--plugin"
                  title={tab.description ?? tab.label}
                  onClick={() => tab.onActivate?.()}
                >
                  {tab.icon ? <span aria-hidden="true">{tab.icon}</span> : null}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          }
        />

        <section
          id="home-mode-panel"
          role="tabpanel"
          aria-label={mode.label}
          tabIndex={-1}
          className="home__composer-area"
        >
          {/* 二级:能力 chip 行(选中分类后隐藏,替换为三级模板行) */}
          {!selectedCategory && (
            <div
              className={
                "home__chips" +
                (listScroll.canScrollLeft ? " home__chips--fade-left" : "") +
                (listScroll.canScrollRight ? " home__chips--fade-right" : "")
              }
            >
              {listScroll.canScrollLeft && (
                <button
                  type="button"
                  className="home__chips-arrow home__chips-arrow--left"
                  aria-label="向左滚动"
                  onClick={() => listScroll.scrollByStep("left")}
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              <div ref={listScroll.containerRef} className="home__chips-list" {...listScroll.bind}>
                {visibleCategories.map((cat) => (
                  <button
                    key={cat.id}
                    className="home__chip"
                    aria-label={cat.label}
                    onClick={() => handleCategoryClick(cat)}
                  >
                    <span className="home__chip-icon" aria-hidden="true">
                      <cat.icon size={16} />
                    </span>
                    <span>{cat.label}</span>
                  </button>
                ))}
                {shouldCollapse && (
                  <button
                    className="home__chip home__chip--more"
                    aria-label="更多"
                    onClick={() => setExpanded(true)}
                  >
                    <span className="home__chip-icon" aria-hidden="true">
                      <MoreIcon size="sm" />
                    </span>
                    <span>更多</span>
                  </button>
                )}
              </div>
              {listScroll.canScrollRight && (
                <button
                  type="button"
                  className="home__chips-arrow home__chips-arrow--right"
                  aria-label="向右滚动"
                  onClick={() => listScroll.scrollByStep("right")}
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          )}

          {/* 三级:推荐模板行(↘),仅在选中某个能力分类后显示 */}
          {selectedCategory && (
            <div
              className={
                "home__chips home__chips--sub" +
                (subScroll.canScrollLeft ? " home__chips--fade-left" : "") +
                (subScroll.canScrollRight ? " home__chips--fade-right" : "")
              }
            >
              {subScroll.canScrollLeft && (
                <button
                  type="button"
                  className="home__chips-arrow home__chips-arrow--left"
                  aria-label="向左滚动"
                  onClick={() => subScroll.scrollByStep("left")}
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              <div ref={subScroll.containerRef} className="home__chips-list" {...subScroll.bind}>
                {selectedCategory.templates.map((tpl, i) => (
                  <button
                    key={i}
                    className="home__template"
                    title={tpl.prompt}
                    aria-label={tpl.title}
                    onClick={() => handleTemplateClick(tpl)}
                  >
                    <span className="home__template-text">{tpl.title}</span>
                    <span className="home__template-arrow" aria-hidden="true">
                      <ArrowRightSubIcon />
                    </span>
                  </button>
                ))}
              </div>
              {subScroll.canScrollRight && (
                <button
                  type="button"
                  className="home__chips-arrow home__chips-arrow--right"
                  aria-label="向右滚动"
                  onClick={() => subScroll.scrollByStep("right")}
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          )}

          <Composer
            streaming={streaming}
            onSend={onSend}
            onCancel={() => {}}
            apiReady={apiReady}
            onOpenSettings={onOpenSettings}
            onPlaceholder={onPlaceholder}
            sceneTag={sceneTag}
            onClearSceneTag={handleClearSceneTag}
            externalText={externalText}
            externalTextNonce={externalTextNonce}
            modelId={modelId}
            models={models}
            onModelChange={onModelChange}
            cwd={cwd}
            workspaces={workspaces}
            onSelectWorkspace={onSelectWorkspace}
            showMeta
            draft={homeDraft}
            draftKey={HOME_DRAFT_KEY}
            onDraftChange={(t) => setDraft(HOME_DRAFT_KEY, t)}
            onSelectMode={(id) => {
              setModeId(id);
              onSelectMode?.(id);
            }}
            onSelectExpert={onSelectExpert}
            onNavigateConnectors={onNavigateConnectors}
            activeExpertName={pendingExpert?.name}
            activeExpertAvatar={pendingExpert?.avatarLocal}
          />
        </section>
        </div>
        {/* 最佳实践案例 —— 对齐 WorkBuddy 的"不知道做什么，试试最佳实践案例" */}
        <section className="home__practices" aria-label="最佳实践案例">
          <header className="home__practices-header">
            <h2 className="home__practices-title">不知道做什么，试试最佳实践案例</h2>
            <div className="home__practices-actions">
              <button
                type="button"
                className="home__practices-refresh"
                aria-label="换一批"
                onClick={() => setPracticesNonce((n) => n + 1)}
              >
                <RefreshIcon />
                <span>换一批</span>
              </button>
              <span className="home__practices-divider" aria-hidden="true">|</span>
              <button
                type="button"
                className="home__practices-dismiss"
                aria-label="收起"
                onClick={() => setPracticesBannerDismissed(true)}
              >
                <CloseIcon />
              </button>
            </div>
          </header>
          {/* 最佳实践案例条走内核 `home.practice-cases` 槽 —— 插件可以换成自己的
              案例集(企业模板 / 行业模板),`onSelect` 负责把 prompt 灌进输入框
              (用户先改再发,不会直接发出)。`fallback` 是接线前的这一条。 */}
          <HomePracticeCases
            onSelect={fillComposer}
            fallback={
              !practicesBannerDismissed && (
                <div className="home__practices-grid" key={practicesNonce}>
                  {bestPractices.map((p) => {
                    const Thumb = p.thumb;
                    return (
                      <button
                        key={p.titleZh}
                        type="button"
                        className="home__practice-card"
                        aria-label={p.titleZh}
                        onClick={() => fillComposer(p.prompt)}
                      >
                        <span className="home__practice-card-thumb" aria-hidden="true">
                          <Thumb />
                        </span>
                        <span className="home__practice-card-caption">{p.titleZh}</span>
                      </button>
                    );
                  })}
                </div>
              )
            }
          />
        </section>
      </div>
    </div>
  );
}
