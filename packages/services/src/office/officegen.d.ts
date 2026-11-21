declare module "officegen" {
  import type { Writable } from "node:stream";

  interface TextStyle {
    bold?: boolean;
    fontSize?: number;
    align?: "left" | "center" | "right";
    bullet?: boolean;
    color?: string;
    fontFamily?: string;
  }

  interface Paragraph {
    addText(text: string, options?: TextStyle): Paragraph;
    addLineBreak(): Paragraph;
  }

  interface TableCell {
    val: string | number | string[];
    opts?: Record<string, unknown>;
  }

  interface TableStyle {
    borders?: boolean;
    tableColWidth?: number;
    tableSize?: number;
    columns?: Array<{ width: number }>;
    [key: string]: unknown;
  }

  interface Docx {
    createP(options?: TextStyle): Paragraph;
    createTable(data: Array<Array<string | number | TableCell>>, style?: TableStyle): void;
    on(event: "error", listener: (error: Error) => void): this;
    generate(stream: Writable): void;
  }

  interface XlsxSheet {
    name: string;
    data: Array<Array<string | number | undefined>>;
    setColumnWidth(column: string, width: number): void;
    setCell(cell: string, value: string | number): void;
  }

  interface Xlsx {
    makeNewSheet(): XlsxSheet;
    on(event: "error", listener: (error: Error) => void): this;
    generate(stream: Writable): void;
  }

  interface Slide {
    addText(text: string, options?: TextStyle): void;
  }

  interface Pptx {
    makeNewSlide(options?: Record<string, unknown>): Slide;
    on(event: "error", listener: (error: Error) => void): this;
    generate(stream: Writable): void;
  }

  function officegen(type: "docx", options?: Record<string, unknown>): Docx;
  function officegen(type: "xlsx", options?: Record<string, unknown>): Xlsx;
  function officegen(type: "pptx", options?: Record<string, unknown>): Pptx;
  export = officegen;
}
