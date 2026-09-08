#!/usr/bin/env node
/** 导入常用药品和检查项目种子数据到医药知识库 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const seedDir = join(scriptDir, "..", "..", "deploy", "clinical-neuro", "kb-seed");

// Inline the import logic (avoids TS import in .mjs).
const kbPath = join(process.env.HOME, ".openbuddy", "medical-kb.json");

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else current += char;
  }
  result.push(current.trim());
  return result;
}

async function main() {
  const { mkdir, writeFile, readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  let state = { version: 1, drugs: [], labs: [], diseases: [], contentHash: "", updatedAt: "" };
  try { state = JSON.parse(await readFile(kbPath, "utf8")); } catch { /* fresh */ }

  for (const [file, key, fieldCount] of [["drugs-common.csv", "drugs", 8], ["labs-common.csv", "labs", 7]]) {
    const csv = readFileSync(join(seedDir, file), "utf8");
    const lines = csv.trim().split(/\r?\n/);
    let added = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 3) continue;
      if (key === "drugs") {
        const record = {
          id: `drug_${createHash("md5").update(cols[0]).digest("hex").slice(0, 12)}`,
          genericName: cols[0], brandNames: cols[1]?.split("|").filter(Boolean) ?? [],
          category: cols[2] ?? "", indications: cols[3]?.split("|").filter(Boolean) ?? [],
          contraindications: cols[4]?.split("|").filter(Boolean) ?? [], adverseReactions: [],
          interactions: [], dosage: cols[5], insuranceClass: cols[6],
          prescriptionOnly: cols[7]?.toLowerCase() !== "false", source: "seed",
          updatedAt: new Date().toISOString(),
        };
        const idx = state.drugs.findIndex((d) => d.genericName === record.genericName);
        if (idx >= 0) state.drugs[idx] = record; else state.drugs.push(record);
      } else {
        const record = {
          id: `lab_${createHash("md5").update(cols[0]).digest("hex").slice(0, 12)}`,
          name: cols[0], abbreviations: cols[1]?.split("|").filter(Boolean) ?? [],
          category: cols[2] ?? "lab", specimenType: cols[3],
          referenceRanges: cols[4] ? [{ label: "成人", range: cols[4], unit: cols[5] ?? "" }] : [],
          clinicalSignificance: cols[6]?.split("|").filter(Boolean) ?? [],
          source: "seed", updatedAt: new Date().toISOString(),
        };
        const idx = state.labs.findIndex((l) => l.name === record.name);
        if (idx >= 0) state.labs[idx] = record; else state.labs.push(record);
      }
      added++;
    }
    console.log(`[kb-seed] ${file}: ${added} 条记录`);
  }

  state.contentHash = createHash("sha256").update(JSON.stringify({ d: state.drugs, l: state.labs })).digest("hex");
  state.updatedAt = new Date().toISOString();
  await mkdir(dirname(kbPath), { recursive: true });
  await writeFile(kbPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  console.log(`[kb-seed] ✓ 已写入 ${kbPath}`);
  console.log(`[kb-seed] 药品: ${state.drugs.length} | 检查: ${state.labs.length} | 疾病: ${state.diseases.length}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
