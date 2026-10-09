import { describe, expect, it } from "vitest";
import { ReadableStream } from "node:stream/web";
import { formatRequest, readNdjsonFrames } from "../protocol.js";

describe("readNdjsonFrames", () => {
  it("Splits frames on LF", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}\n{"b":2}\n'));
        controller.close();
      },
    });
    const frames: string[] = [];
    for await (const f of readNdjsonFrames(stream)) frames.push(f);
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("Accepts CRLF as a delimiter", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}\r\n{"b":2}\r\n'));
        controller.close();
      },
    });
    const frames: string[] = [];
    for await (const f of readNdjsonFrames(stream)) frames.push(f);
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("Preserves U+2028 and U+2029 inside string bodies", async () => {
    const body = '{"a":"line\u2028sep\u2029end"}\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const frames: string[] = [];
    for await (const f of readNdjsonFrames(stream)) frames.push(f);
    expect(frames).toEqual(['{"a":"line\u2028sep\u2029end"}']);
  });

  it("Flushes a final unterminated frame at EOF", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}'));
        controller.close();
      },
    });
    const frames: string[] = [];
    for await (const f of readNdjsonFrames(stream)) frames.push(f);
    expect(frames).toEqual(['{"a":1}']);
  });
});

describe("formatRequest", () => {
  it("Appends a single LF", () => {
    const line = formatRequest({ jsonrpc: "2.0", id: "x", method: "app.echo", params: { hi: 1 } });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.slice(0, -1))).toEqual({
      jsonrpc: "2.0",
      id: "x",
      method: "app.echo",
      params: { hi: 1 },
    });
  });
});
