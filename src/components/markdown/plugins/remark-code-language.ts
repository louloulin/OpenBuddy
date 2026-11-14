import { visit } from "unist-util-visit";
import type { Root, Code } from "mdast";
import { LanguageUtil } from "../utils/language-util";

const LANGUAGE_ALIASES: Record<string, string> = {
  vue: "xml",
  svelte: "xml",
  tsx: "typescript",
  ts: "typescript",
  jsx: "javascript",
  js: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  cs: "csharp",
  kt: "kotlin",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  pl: "perl",
  golang: "go",
};

const KNOWN_LANGUAGES = new Set([
  "javascript",
  "js",
  "typescript",
  "ts",
  "jsx",
  "tsx",
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
  "python",
  "py",
  "java",
  "go",
  "golang",
  "rust",
  "rs",
  "c",
  "cpp",
  "cxx",
  "cc",
  "csharp",
  "cs",
  "php",
  "ruby",
  "rb",
  "perl",
  "pl",
  "lua",
  "swift",
  "kotlin",
  "kt",
  "scala",
  "groovy",
  "r",
  "matlab",
  "julia",
  "bash",
  "sh",
  "zsh",
  "powershell",
  "ps1",
  "cmd",
  "bat",
  "json",
  "yaml",
  "yml",
  "xml",
  "toml",
  "ini",
  "csv",
  "sql",
  "mysql",
  "postgresql",
  "pgsql",
  "plsql",
  "mongodb",
  "markdown",
  "md",
  "rst",
  "asciidoc",
  "tex",
  "latex",
  "dockerfile",
  "makefile",
  "cmake",
  "nginx",
  "apache",
  "graphql",
  "protobuf",
  "proto",
  "thrift",
  "diff",
  "patch",
  "git",
  "gitignore",
  "vim",
  "regex",
  "asm",
  "assembly",
  "objectivec",
  "objc",
  "objective-c",
  "elixir",
  "erlang",
  "haskell",
  "clojure",
  "lisp",
  "scheme",
  "dart",
  "flutter",
  "wasm",
  "webassembly",
  "properties",
  "env",
  "dotenv",
  "text",
  "plaintext",
  "txt",
  "mermaid",
]);

function getHighlightLanguage(lang: string): string {
  const lowerLang = lang.toLowerCase();
  return LANGUAGE_ALIASES[lowerLang] || lowerLang;
}

function isKnownLanguage(str: string): boolean {
  return KNOWN_LANGUAGES.has(str.toLowerCase());
}

/**
 * Parse IDE-style fence languages like:
 * - `ts:1:20:src/foo.ts`
 * - `1:20:src/foo.ts`
 * - `ts:1-20:src/foo.ts`
 * into a real hljs language + meta string on the node.
 */
export function remarkCodeLanguage() {
  return (root: Root) => {
    visit(root, "code", (node: Code) => {
      if (typeof node.lang !== "string" || !node.lang) return;

      const originalLang = node.lang;
      let inferredLanguage: string | null = null;
      let shouldSetMeta = false;

      const match3 = originalLang.match(/^([a-zA-Z][a-zA-Z0-9]*):(\d+):(\d+):(.+)$/);
      if (match3) {
        const metaLanguage = match3[1];
        const filePath = match3[4];
        inferredLanguage = getHighlightLanguage(
          isKnownLanguage(metaLanguage)
            ? metaLanguage.toLowerCase()
            : LanguageUtil.getLanguageByFilename(filePath),
        );
        shouldSetMeta = true;
      }

      if (!inferredLanguage) {
        const match2 = originalLang.match(/^([a-zA-Z][a-zA-Z0-9]*):(\d+)-(\d+):(.+)$/);
        if (match2) {
          const metaLanguage = match2[1];
          const filePath = match2[4];
          inferredLanguage = getHighlightLanguage(
            isKnownLanguage(metaLanguage)
              ? metaLanguage.toLowerCase()
              : LanguageUtil.getLanguageByFilename(filePath),
          );
          shouldSetMeta = true;
        }
      }

      if (!inferredLanguage) {
        const match1 = originalLang.match(/^(\d+):(\d+):(.+)$/);
        if (match1) {
          const filePath = match1[3];
          inferredLanguage = getHighlightLanguage(
            LanguageUtil.getLanguageByFilename(filePath),
          );
          shouldSetMeta = true;
        }
      }

      if (!inferredLanguage && originalLang.includes(":")) {
        const firstPart = originalLang.split(":")[0];
        if (firstPart && isKnownLanguage(firstPart)) {
          inferredLanguage = getHighlightLanguage(firstPart.toLowerCase());
          shouldSetMeta = true;
        }
      }

      // ```ts title="src/a.ts"``` / ```ts file=src/a.ts``` / ```ts src/a.ts```: a whole-file block.
      if (!shouldSetMeta && typeof node.meta === "string" && node.meta.trim()) {
        const info = node.meta.trim();
        const named = info.match(/(?:^|\s)(?:title|file|filename|path)=(?:"([^"]+)"|'([^']+)'|(\S+))/);
        const bare = /^[^\s=]+$/.test(info) && /[./\\]/.test(info) && !/^\d/.test(info) ? info : undefined;
        const filePath = named ? named[1] ?? named[2] ?? named[3] : bare;
        if (filePath && !/\s/.test(filePath)) {
          inferredLanguage = getHighlightLanguage(isKnownLanguage(originalLang) ? originalLang.toLowerCase() : LanguageUtil.getLanguageByFilename(filePath));
          const meta = `${/^[a-zA-Z][a-zA-Z0-9+#-]*$/.test(originalLang) ? originalLang : "text"}:${filePath}`;
          node.lang = inferredLanguage || originalLang;
          // mdast-util-to-hast copies node.meta onto the code element's data: rewrite it too.
          node.meta = meta;
          node.data = { ...(node.data || {}), meta, hProperties: { ...((node.data as { hProperties?: Record<string, unknown> } | undefined)?.hProperties || {}), meta } } as typeof node.data;
          return;
        }
      }

      if (inferredLanguage && shouldSetMeta) {
        node.lang = inferredLanguage;
        node.meta = originalLang;
        // mdast CodeData is narrow; we stash meta for rehype-code-block.
        node.data = {
          ...(node.data || {}),
          meta: originalLang,
          hProperties: {
            ...((node.data as { hProperties?: Record<string, unknown> } | undefined)
              ?.hProperties || {}),
            meta: originalLang,
          },
        } as typeof node.data;
      }
    });
  };
}
