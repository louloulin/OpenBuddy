import type { ConnectorCatalog, ConnectorItem } from "@openbuddy/protocol/dto";

/**
 * 连接器目录 (20261116-pii W2.4 P2).
 *
 * Only entries that can actually be installed are listed: each one carries a real
 * MCP config template (stdio command or HTTP URL). We deliberately do not copy
 * WorkBuddy's marketing catalog — those entries have no usable MCP config.
 */
interface Template {
  id: string;
  name: string;
  desc: string;
  cat: "dev" | "data" | "web" | "files" | "office";
  examples: string[];
  auth?: { label: string; key: string; placeholder?: string; docUrl?: string };
  config: Record<string, unknown>;
}

const TEMPLATES: Template[] = [
  {
    id: "filesystem",
    name: "本地文件系统",
    desc: "在指定目录内读写、搜索文件。默认绑定当前工作区，首次使用前请把路径改成你的工作目录。",
    cat: "files",
    examples: ["列出工作区里的 Markdown 文件", "把 report.md 里的表格改成 CSV"],
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], exposure: "direct" },
  },
  {
    id: "git",
    name: "Git 仓库",
    desc: "查看提交历史、分支、diff 与文件内容，帮助分析代码演进。需要本机安装 uv/uvx 与 Git。",
    cat: "dev",
    examples: ["总结最近 10 个提交", "这个分支相对 main 改了哪些文件"],
    config: { command: "uvx", args: ["mcp-server-git", "--repository", "."], exposure: "direct" },
  },
  {
    id: "fetch",
    name: "网页抓取",
    desc: "抓取网页并转成 Markdown，适合读文档、博客和 changelog。",
    cat: "web",
    examples: ["读一下这个 URL 的正文", "把文档站的快速开始整理成步骤"],
    config: { command: "uvx", args: ["mcp-server-fetch"], exposure: "direct" },
  },
  {
    id: "sqlite",
    name: "SQLite 数据库",
    desc: "对本地 SQLite 文件执行只读查询与表结构浏览。把 --db-path 改成你的数据库路径。",
    cat: "data",
    examples: ["列出所有表", "统计每个月的订单数"],
    config: { command: "uvx", args: ["mcp-server-sqlite", "--db-path", "./data.db"], exposure: "direct" },
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    desc: "连接 PostgreSQL 执行查询。需要提供只读连接串，注意不要使用生产写权限账号。",
    cat: "data",
    examples: ["列出 schema 和表", "近 7 天的日活是多少"],
    auth: { label: "DATABASE_URL", key: "DATABASE_URL", placeholder: "postgresql://readonly@host:5432/db" },
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"],
      exposure: "direct",
    },
  },
  {
    id: "github",
    name: "GitHub",
    desc: "查询仓库、Issue 与 PR。需要一个只带 repo 读权限的 Personal Access Token。",
    cat: "dev",
    examples: ["列出这个仓库最近的 PR", "总结 open 的 issue"],
    auth: {
      label: "GITHUB_PERSONAL_ACCESS_TOKEN",
      key: "GITHUB_PERSONAL_ACCESS_TOKEN",
      placeholder: "github_pat_…",
      docUrl: "https://github.com/settings/tokens",
    },
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" },
      exposure: "direct",
    },
  },
  {
    id: "playwright",
    name: "浏览器自动化",
    desc: "用 Playwright 驱动真实浏览器：打开页面、点击、填表、截图。首次运行会下载浏览器。",
    cat: "web",
    examples: ["打开这个页面并截图", "登录后把列表前 5 条抓下来"],
    config: { command: "npx", args: ["-y", "@playwright/mcp@latest"], exposure: "deferred" },
  },
  {
    id: "memory",
    name: "知识图谱记忆",
    desc: "把实体与关系存进本地知识图谱，跨会话复用。适合长期项目。",
    cat: "office",
    examples: ["记住客户 A 的偏好", "我和客户 A 上次聊了什么"],
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], exposure: "direct" },
  },
  {
    id: "sequential-thinking",
    name: "结构化思考",
    desc: "把复杂问题拆成可回溯的思考步骤，适合方案评审与排障。",
    cat: "office",
    examples: ["用结构化思考拆解这个迁移方案", "列出排障思路"],
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], exposure: "direct" },
  },
];

const CATEGORIES = [
  { id: "all", zh: "全部" },
  { id: "dev", zh: "研发" },
  { id: "data", zh: "数据" },
  { id: "web", zh: "网页" },
  { id: "files", zh: "文件" },
  { id: "office", zh: "办公" },
];

function itemOf(template: Template): ConnectorItem {
  return {
    id: template.id,
    name: template.name,
    desc: template.desc,
    source: template.id,
    kind: "mcp",
    ...(template.auth ? { authMode: "token" as const } : {}),
    examplesZh: template.examples,
    cat: template.cat,
    ...(template.auth
      ? {
          tokenSchema: {
            title: `${template.name} 凭据`,
            description: template.desc,
            ...(template.auth.docUrl ? { docUrl: template.auth.docUrl } : {}),
            ...(template.auth.docUrl ? { docLabel: "获取 Token" } : {}),
            fields: [
              {
                key: template.auth.key,
                label: template.auth.label,
                type: "password",
                required: true,
                ...(template.auth.placeholder ? { placeholder: template.auth.placeholder } : {}),
              },
            ],
          },
        }
      : {}),
  };
}

/** Stateless built-in catalog: `root` is accepted for compatibility but ignored. */
export class ConnectorCatalogService {
  readonly root = "builtin:connectors";
  catalog(): ConnectorCatalog {
    return {
      root: this.root,
      categories: CATEGORIES,
      connectors: TEMPLATES.map(itemOf),
    };
  }
  /** Raw `{ "mcpServers": { … } }` template for one connector ("" when unknown). */
  mcpConfig(source: string): string {
    const template = TEMPLATES.find((entry) => entry.id === source);
    return template ? JSON.stringify({ mcpServers: { [template.id]: template.config } }, null, 2) : "";
  }
}
