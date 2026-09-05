import { describe, it, expect, beforeEach } from "vitest";
import {
  buildPropfindBody,
  parsePropfindResponse,
  normalizePath,
  joinStoragePath,
  registerStorageProvider,
  unregisterStorageProvider,
  listStorageProviders,
  getStorageProvider,
  resetStorageProviders,
  type StorageProvider,
} from "../files/cloud-storage";

describe("路径操作", () => {
  it("normalizePath 确保前导 / + 去多余斜杠", () => {
    expect(normalizePath("a/b")).toBe("/a/b");
    expect(normalizePath("/a//b/")).toBe("/a/b");
    expect(normalizePath("\\a\\b")).toBe("/a/b");
    expect(normalizePath("/")).toBe("/");
  });
  it("joinStoragePath", () => {
    expect(joinStoragePath("/base", "sub")).toBe("/base/sub");
    expect(joinStoragePath("/base/", "/sub/")).toBe("/base/sub");
  });
});

describe("buildPropfindBody", () => {
  it("含 propfind + displayname + resourcetype", () => {
    const body = buildPropfindBody();
    expect(body).toContain("propfind");
    expect(body).toContain("displayname");
    expect(body).toContain("resourcetype");
  });
});

describe("parsePropfindResponse", () => {
  const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/files/user/</D:href>
    <D:propstat><D:prop>
      <D:resourcetype><D:collection/></D:resourcetype>
    </D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/files/user/doc.md</D:href>
    <D:propstat><D:prop>
      <D:displayname>doc.md</D:displayname>
      <D:getcontentlength>1024</D:getcontentlength>
      <D:getlastmodified>Mon, 30 Jul 2026 10:00:00 GMT</D:getlastmodified>
      <D:getcontenttype>text/markdown</D:getcontenttype>
    </D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/files/user/folder/</D:href>
    <D:propstat><D:prop>
      <D:resourcetype><D:collection/></D:resourcetype>
    </D:prop></D:propstat>
  </D:response>
</D:multistatus>`;

  it("解析文件 + 目录(跳过 basePath 自身)", () => {
    const entries = parsePropfindResponse(xml, "/files/user");
    expect(entries).toHaveLength(2); // doc.md + folder(自身被跳过)
    const doc = entries.find((e) => e.name === "doc.md");
    expect(doc).toBeDefined();
    expect(doc!.isDir).toBe(false);
    expect(doc!.size).toBe(1024);
    expect(doc!.mimeType).toBe("text/markdown");
    const folder = entries.find((e) => e.name === "folder");
    expect(folder?.isDir).toBe(true);
  });

  it("大小写不敏感(D/d 前缀)", () => {
    const lowerXml = xml.replace(/<D:/g, "<d:").replace(/<\/D:/g, "</d:");
    const entries = parsePropfindResponse(lowerXml, "/files/user");
    expect(entries).toHaveLength(2);
  });

  it("空响应 → 空数组", () => {
    expect(parsePropfindResponse("<xml/>", "/x")).toEqual([]);
  });
});

describe("provider 注册表", () => {
  beforeEach(resetStorageProviders);

  const provider = (id: string, enabled = true): StorageProvider => ({
    id,
    label: id,
    isEnabled: () => enabled,
    list: async () => [],
    readText: async () => null,
    writeText: async () => true,
    delete: async () => true,
    makeDir: async () => true,
  });

  it("注册后可列出", () => {
    registerStorageProvider(provider("webdav"));
    registerStorageProvider(provider("local", false));
    expect(listStorageProviders()).toEqual([{ id: "webdav", label: "webdav" }]);
  });
  it("同 id 不重复", () => {
    registerStorageProvider(provider("a"));
    registerStorageProvider(provider("a"));
    expect(listStorageProviders()).toHaveLength(1);
  });
  it("getStorageProvider 按 id 取(仅启用)", () => {
    registerStorageProvider(provider("a"));
    registerStorageProvider(provider("b", false));
    expect(getStorageProvider("a")?.id).toBe("a");
    expect(getStorageProvider("b")).toBeNull();
  });
  it("unregister 移除", () => {
    registerStorageProvider(provider("a"));
    expect(unregisterStorageProvider("a")).toBe(true);
    expect(listStorageProviders()).toHaveLength(0);
    expect(unregisterStorageProvider("nope")).toBe(false);
  });
});
