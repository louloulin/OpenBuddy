import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { PromptTemplate } from "@earendil-works/pi-coding-agent";

/**
 * Synchronous prompt-template scan for `promptsOverride` (pii W2.7 / S8). Pi calls the override
 * inside `reload()`, which is synchronous, so the disk read cannot be async. Files are the same
 * ones `PromptsService` writes: Markdown with optional `description` / `argument-hint` frontmatter.
 */
export function readPromptTemplatesSync(dirs: Array<{ dir: string; scope: "global" | "workspace" }>): PromptTemplate[] {
  const out: PromptTemplate[] = [];
  for (const { dir, scope } of dirs) {
    if (!existsSync(dir)) continue;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!/\.md$/i.test(name)) continue;
      const filePath = join(dir, name);
      try {
        if (!statSync(filePath).isFile()) continue;
        const raw = readFileSync(filePath, "utf8");
        const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
        let description = typeof frontmatter.description === "string" ? frontmatter.description : "";
        if (!description) {
          const first = body.split("\n").find((l) => l.trim());
          if (first) description = first.trim().slice(0, 60) + (first.trim().length > 60 ? "…" : "");
        }
        const hint = typeof frontmatter["argument-hint"] === "string" ? frontmatter["argument-hint"] : undefined;
        out.push({
          name: name.replace(/\.md$/i, ""),
          description,
          ...(hint ? { argumentHint: hint } : {}),
          content: body,
          sourceInfo: { path: filePath, source: scope === "global" ? "user" : "project", scope: scope === "global" ? "user" : "project", origin: "top-level" },
          filePath,
        });
      } catch {
        /* unreadable or bad frontmatter: skip */
      }
    }
  }
  return out;
}
