/**
 * StreamingMarkdown-chips.test.tsx — Plan5 B.5
 *
 * Validates that `[[cite:id]]` / `[[artifact:id]]` markers in streaming text
 * are tokenized into chip tokens and rendered as `<CitationChip>` /
 * `<ArtifactChip>` elements.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StreamingMarkdown, __test__ } from "../StreamingMarkdown";
import { ChatCitationProvider } from "../parts/CitationChip";
import { ChatArtifactProvider } from "../parts/ArtifactChip";

const { tokenizeInline } = __test__;

describe("StreamingMarkdown — citation / artifact chips", () => {
  it("tokenizeInline extracts citation marker", () => {
    const tokens = tokenizeInline("see [[cite:doc-1]] for context");
    expect(tokens).toEqual([
      { kind: "text", value: "see " },
      { kind: "citation", id: "doc-1" },
      { kind: "text", value: " for context" },
    ]);
  });

  it("tokenizeInline extracts artifact marker", () => {
    const tokens = tokenizeInline("output: [[artifact:abc123def]]");
    expect(tokens).toEqual([
      { kind: "text", value: "output: " },
      { kind: "artifact", id: "abc123def" },
    ]);
  });

  it("renders citation chip in streaming markdown", () => {
    const { container } = render(
      <StreamingMarkdown text="hello [[cite:doc-1]] world" />,
    );
    const chip = container.querySelector(".citation-chip");
    expect(chip).toBeTruthy();
    expect(chip?.getAttribute("data-citation-id")).toBe("doc-1");
  });

  it("renders artifact chip in streaming markdown", () => {
    const { container } = render(
      <StreamingMarkdown text="see [[artifact:xyz789]]" />,
    );
    const chip = container.querySelector(".artifact-chip");
    expect(chip).toBeTruthy();
    expect(chip?.getAttribute("data-artifact-id")).toBe("xyz789");
  });

  it("renders chips inside fenced code literally (no tokenization)", () => {
    const { container } = render(
      <StreamingMarkdown
        text={"```\nliteral [[cite:doc-1]] not a chip\n```"}
      />,
    );
    // The marker inside a fenced code block should render as plain text,
    // because fenced code goes through `tokenize` (block tokenizer), not
    // `tokenizeInline`. The streaming-code-stub class should be present
    // with the marker intact.
    const stub = container.querySelector(".streaming-code-stub");
    expect(stub).toBeTruthy();
    expect(stub?.textContent).toContain("[[cite:doc-1]]");
    expect(container.querySelector(".citation-chip")).toBeNull();
  });

  it("respects resolver from ChatCitationProvider", () => {
    const { container } = render(
      <ChatCitationProvider
        resolve={(id) => (id === "doc-1" ? { id, title: "已解决" } : undefined)}
      >
        <StreamingMarkdown text="see [[cite:doc-1]]" />
      </ChatCitationProvider>,
    );
    expect(container.querySelector(".citation-chip")?.textContent).toContain(
      "已解决",
    );
  });

  it("respects resolver from ChatArtifactProvider", () => {
    const { container } = render(
      <ChatArtifactProvider
        resolve={(id) =>
          id === "abc123" ? { id, kind: "code", title: "schema.sql", hash: "deadbeef12345678" } : undefined
        }
      >
        <StreamingMarkdown text="see [[artifact:abc123]]" />
      </ChatArtifactProvider>,
    );
    expect(container.querySelector(".artifact-chip")?.textContent).toContain(
      "schema.sql",
    );
    expect(container.querySelector(".artifact-chip")?.textContent).toContain(
      "deadbe",
    );
  });
});
