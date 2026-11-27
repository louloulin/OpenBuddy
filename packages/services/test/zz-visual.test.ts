import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buildPptx, type PptxSpec } from "../src/office/index";
it("export decks to /tmp", async () => {
  for (const name of ["3d-printing", "toptoy", "hog"]) {
    const spec = JSON.parse(readFileSync(`/tmp/${name}.deck.json`, "utf8")) as PptxSpec;
    writeFileSync(`/tmp/${name}.pptx`, await buildPptx(spec));
  }
  const extra: PptxSpec = { title: "图形样例", slides: [
    { title: "分支产业链", kicker: "产业链", blocks: [{ kind: "mermaid", source: 'flowchart LR\n  A["上游<br/>锂矿 / 正极材料"] --> B["电芯制造"]\n  A --> C["电机电控"]\n  B --> D["整车装配"]\n  C --> D\n  D --> E["终端销售<br/>直营 / 经销"]\n  A --> F["回收利用"]\n  E --> F', caption: "分支与汇合" }, { kind: "paragraph", text: "说明文字" }] },
    { title: "自上而下", kicker: "流程", blocks: [{ kind: "mermaid", source: 'flowchart TD\n  A["需求"] --> B["设计"]\n  A --> C["采购"]\n  B --> D["生产"]\n  C --> D', caption: "TD" }] },
    { title: "利润流向（长名称）", kicker: "财务", blocks: [{ kind: "mermaid", source: "sankey-beta\n营业收入,营业成本,1284639.23\n营业收入,毛利,624185.78\n毛利,销售费用,120000\n毛利,管理费用及研发费用,108594.78\n毛利,经营利润,395591\n经营利润,所得税,102061\n经营利润,净利润,293530", caption: "桑基图" }] },
  ] };
  writeFileSync(`/tmp/extra.pptx`, await buildPptx(extra));
});
