/**
 * ChatViewEmptyState — 空状态(wand hero + 能力标签 + quick prompts)。
 *
 * Plan5 Phase B.8:在保持既有 `chatview__empty-state-*` 结构的前提下,
 * 补齐 subtitle / hint / tags / 描述,与改造前 `ChatView.tsx:1147-1193` 的 DOM
 * 逐字一致(快照测试覆盖),并新增 `chatview__empty-state-subtitle`、
 * `chatview__empty-state-hint`、`chatview__empty-state-tags` 三个已有 class。
 */
import {
  WandSparkles,
  FolderTree,
  Bug,
  FlaskConical,
  BookOpen,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type QuickPrompt = {
  id: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  prompt: string;
};

export const QUICK_PROMPTS: ReadonlyArray<QuickPrompt> = [
  {
    id: "explore",
    icon: FolderTree,
    title: "梳理项目结构",
    desc: "概览代码组织、关键模块、入口文件",
    prompt: "帮我梳理一下当前项目的目录结构和关键模块。",
  },
  {
    id: "find-bug",
    icon: Bug,
    title: "查找 Bug",
    desc: "审查最近的改动,定位并修复问题",
    prompt: "审查最近修改的代码,帮我找出潜在的 Bug 并修复。",
  },
  {
    id: "write-tests",
    icon: FlaskConical,
    title: "写单元测试",
    desc: "为关键函数补充覆盖率的测试",
    prompt: "为当前目录的关键函数补充单元测试,提升覆盖率。",
  },
  {
    id: "explain",
    icon: BookOpen,
    title: "解释代码逻辑",
    desc: "用通俗语言说明某段代码的作用",
    prompt: "挑一个核心文件,逐段解释它的逻辑和设计意图。",
  },
  {
    id: "optimize",
    icon: Zap,
    title: "性能优化",
    desc: "寻找热点并提出改进建议",
    prompt: "检查当前代码,找出性能瓶颈并给出优化建议。",
  },
];

export const EMPTY_STATE_TAGS = [
  "助理",
  "项目",
  "专家 / 技能 / 连接器",
  "自动化",
  "资料库",
];

export type ChatViewEmptyStateProps = {
  /** quick prompt 图标与标题点击后回填 composer。 */
  onPickPrompt: (text: string) => void;
};

export function ChatViewEmptyState({ onPickPrompt }: ChatViewEmptyStateProps) {
  return (
    <div className="chatview__empty-state" role="status">
      {/* R8.27 — hero illustration: halo div + brand-tinted lucide WandSparkles. */}
      <div className="chatview__empty-state-hero">
        <div className="chatview__empty-state-halo" aria-hidden="true" />
        <WandSparkles
          className="chatview__empty-state-icon"
          size={28}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>
      <h2 className="chatview__empty-state-title">开始一段新的对话</h2>
      <p className="chatview__empty-state-subtitle">
        OpenBuddy 帮你调度专家 / 技能 / 连接器,在下方输入框描述你的任务即可。
      </p>
      <p className="chatview__empty-state-hint">
        按 <kbd>?</kbd> 查看全部快捷键,<kbd>/</kbd> 调用技能与指令,<kbd>@</kbd> 引用对话文件。
      </p>
      <ul className="chatview__empty-state-tags" aria-label="可用能力">
        {EMPTY_STATE_TAGS.map((tag) => (
          <li className="chatview__empty-state-tag" key={tag}>
            {tag}
          </li>
        ))}
      </ul>
      {/* R8.10 — Quick-prompt cards. Click seeds the composer via the same
          resendText pipe as inline-edit / revision-pager. */}
      <div className="chatview__quick-prompts" role="group" aria-label="快速开始模板">
        {QUICK_PROMPTS.map((qp) => {
          const Icon = qp.icon;
          return (
            <button
              key={qp.id}
              type="button"
              className="chatview__quick-prompt"
              data-testid={`quick-prompt-${qp.id}`}
              onClick={() => onPickPrompt(qp.prompt)}
              aria-label={qp.title}
            >
              <span className="chatview__quick-prompt-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <span className="chatview__quick-prompt-body">
                <span className="chatview__quick-prompt-title">{qp.title}</span>
                <span className="chatview__quick-prompt-desc">{qp.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
