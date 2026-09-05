import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { FilterableList } from "./FilterableList";

interface Item {
  id: string;
  title: string;
  tags: readonly string[];
}

describe("FilterableList", () => {
  const items: Item[] = [
    { id: "1", title: "Alpha", tags: ["red"] },
    { id: "2", title: "Beta", tags: ["blue"] },
    { id: "3", title: "Gamma", tags: ["red", "blue"] },
  ];

  it("renders every item when the query is empty", () => {
    const html = renderToString(
      <FilterableList items={items} getHaystack={(item) => [item.title, ...item.tags]}>
        {(visible) => <ul>{visible.map((entry) => <li key={entry.id}>{entry.record.title}</li>)}</ul>}
      </FilterableList>,
    );
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("Gamma");
  });

  it("narrows the visible items when the query matches", () => {
    const html = renderToString(
      <FilterableList items={items} getHaystack={(item) => [item.title, ...item.tags]} initialQuery="red">
        {(visible) => <ul>{visible.map((entry) => <li key={entry.id}>{entry.record.title}</li>)}</ul>}
      </FilterableList>,
    );
    expect(html).toContain("Alpha");
    expect(html).toContain("Gamma");
    expect(html).not.toContain("Beta");
  });

  it("renders the emptyState prop when no record matches", () => {
    const html = renderToString(
      <FilterableList items={items} getHaystack={(item) => item.title} initialQuery="zzz" emptyState={<p>nothing here</p>}>
        {() => <ul />}
      </FilterableList>,
    );
    expect(html).toContain("nothing here");
  });
});