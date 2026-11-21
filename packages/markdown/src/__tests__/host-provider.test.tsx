import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { getMarkdownHost, MarkdownHostProvider, setMarkdownHost, useMarkdownHost, type MarkdownHost } from "../host";

const host = (name: string) => ({ name }) as unknown as MarkdownHost;
function Probe({ id }: { id: string }) {
  return <span data-testid={id}>{(useMarkdownHost() as unknown as { name: string }).name}</span>;
}

describe("MarkdownHostProvider (20261115-md R6)", () => {
  const original = getMarkdownHost();
  afterEach(() => setMarkdownHost(original));

  it("the outermost provider installs the package-wide host for code outside React", () => {
    render(<MarkdownHostProvider host={host("app")}><Probe id="a" /></MarkdownHostProvider>);
    expect(screen.getByTestId("a").textContent).toBe("app");
    expect((getMarkdownHost() as unknown as { name: string }).name).toBe("app");
  });

  it("a nested provider only changes its own subtree, never the package-wide host", () => {
    render(
      <MarkdownHostProvider host={host("app")}>
        <Probe id="outer" />
        <MarkdownHostProvider host={host("preview")}>
          <Probe id="inner" />
        </MarkdownHostProvider>
      </MarkdownHostProvider>,
    );
    expect(screen.getByTestId("outer").textContent).toBe("app");
    expect(screen.getByTestId("inner").textContent).toBe("preview");
    expect((getMarkdownHost() as unknown as { name: string }).name).toBe("app");
  });
});
