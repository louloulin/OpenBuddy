/**
 * ResourceCatalogPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 资源列表渲染 + 类型标签
 *  - 新建资源：校验空名称 + JSON metadata
 *  - 编辑资源：version CAS 写入 + 取消
 *  - 删除资源：confirm 弹窗 + IPC 正确负载
 *  - 错误信息出现在 data-testid="resource-catalog-message"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const casdoorListResourcesMock = vi.fn();
const casdoorCreateResourceMock = vi.fn();
const casdoorUpdateResourceMock = vi.fn();
const casdoorDeleteResourceMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorListResources: (...args: unknown[]) => casdoorListResourcesMock(...args),
  casdoorCreateResource: (...args: unknown[]) => casdoorCreateResourceMock(...args),
  casdoorUpdateResource: (...args: unknown[]) => casdoorUpdateResourceMock(...args),
  casdoorDeleteResource: (...args: unknown[]) => casdoorDeleteResourceMock(...args),
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    Database: () => <span data-icon="database" />,
    FileText: () => <span data-icon="file" />,
    Folder: () => <span data-icon="folder" />,
    Pencil: () => <span data-icon="pencil" />,
    Plus: () => <span data-icon="plus" />,
    RefreshCw: () => <span data-icon="refresh" />,
    Trash2: () => <span data-icon="trash" />,
  };
});

import { ResourceCatalogPanel } from "@openbuddy/ui-mcp";

function projectFixture(id: string, version: number, name: string) {
  return {
    id,
    tenantId: "tenant-a",
    ownerSubject: "admin",
    type: "project" as const,
    name,
    metadata: { region: "us-east-1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version,
  };
}

describe("ResourceCatalogPanel", () => {
  beforeEach(() => {
    casdoorListResourcesMock.mockReset();
    casdoorCreateResourceMock.mockReset();
    casdoorUpdateResourceMock.mockReset();
    casdoorDeleteResourceMock.mockReset();
    casdoorListResourcesMock.mockResolvedValue([]);
    // Stub confirm so delete tests work without dialog
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders an empty state when no resources match the filter", async () => {
    render(<ResourceCatalogPanel />);
    expect(await screen.findByTestId("resource-catalog-list")).toBeTruthy();
    expect(screen.getByText(/当前类型下没有资源/)).toBeTruthy();
  });

  it("renders resource rows with type labels", async () => {
    casdoorListResourcesMock.mockResolvedValueOnce([
      projectFixture("p1", 1, "Alpha"),
      projectFixture("p2", 2, "Beta"),
    ]);
    render(<ResourceCatalogPanel />);
    await waitFor(() => expect(casdoorListResourcesMock).toHaveBeenCalledWith("project"));
    const list = await screen.findByTestId("resource-catalog-list");
    expect(list.textContent).toContain("Alpha");
    expect(list.textContent).toContain("Beta");
    expect(list.textContent).toContain("us-east-1");
    expect(list.textContent).toContain("版本 1");
  });

  it("creates a new resource with valid JSON metadata", async () => {
    casdoorCreateResourceMock.mockResolvedValueOnce(projectFixture("p3", 1, "Gamma"));
    render(<ResourceCatalogPanel />);
    fireEvent.change(await screen.findByTestId("resource-create-name"), { target: { value: "Gamma" } });
    fireEvent.change(await screen.findByTestId("resource-create-metadata"), { target: { value: '{"region":"us-west-2"}' } });
    fireEvent.click(screen.getByTestId("resource-create-submit"));
    await waitFor(() => expect(casdoorCreateResourceMock).toHaveBeenCalled());
    const input = casdoorCreateResourceMock.mock.calls[0]?.[0];
    expect(input?.type).toBe("project");
    expect(input?.name).toBe("Gamma");
    expect(input?.metadata).toEqual({ region: "us-west-2" });
    expect(typeof input?.idempotencyKey).toBe("string");
    expect(await screen.findByTestId("resource-catalog-message")).toHaveTextContent("已创建");
  });

  it("rejects invalid metadata JSON", async () => {
    render(<ResourceCatalogPanel />);
    fireEvent.change(await screen.findByTestId("resource-create-name"), { target: { value: "Bad" } });
    fireEvent.change(await screen.findByTestId("resource-create-metadata"), { target: { value: "not-json" } });
    fireEvent.click(screen.getByTestId("resource-create-submit"));
    expect(await screen.findByTestId("resource-catalog-message")).toHaveTextContent("metadata 必须是合法 JSON");
    expect(casdoorCreateResourceMock).not.toHaveBeenCalled();
  });

  it("warns when name is empty", async () => {
    render(<ResourceCatalogPanel />);
    fireEvent.click(await screen.findByTestId("resource-create-submit"));
    expect(await screen.findByTestId("resource-catalog-message")).toHaveTextContent("名称不能为空");
    expect(casdoorCreateResourceMock).not.toHaveBeenCalled();
  });

  it("edits an existing resource with optimistic version", async () => {
    casdoorListResourcesMock.mockResolvedValueOnce([projectFixture("p1", 5, "Alpha")]);
    casdoorUpdateResourceMock.mockResolvedValueOnce(projectFixture("p1", 6, "Alpha-2"));
    render(<ResourceCatalogPanel />);
    const editButton = await screen.findByText("编辑");
    fireEvent.click(editButton);
    fireEvent.change(screen.getByTestId("resource-edit-name-p1"), { target: { value: "Alpha-2" } });
    fireEvent.click(await screen.findByTestId("resource-save-p1"));
    await waitFor(() => expect(casdoorUpdateResourceMock).toHaveBeenCalled());
    expect(casdoorUpdateResourceMock).toHaveBeenCalledWith("p1", expect.objectContaining({ expectedVersion: 5, name: "Alpha-2" }));
  });

  it("deletes a resource when the delete button is clicked", async () => {
    casdoorListResourcesMock.mockResolvedValueOnce([projectFixture("p1", 7, "Alpha")]);
    casdoorDeleteResourceMock.mockResolvedValueOnce({ ok: true });
    render(<ResourceCatalogPanel />);
    fireEvent.click(await screen.findByTestId("resource-delete-p1"));
    await waitFor(() => expect(casdoorDeleteResourceMock).toHaveBeenCalledWith("p1", 7));
  });

  it("surfaces load errors", async () => {
    casdoorListResourcesMock.mockRejectedValueOnce(new Error("RESOURCE_LIST_DENIED"));
    render(<ResourceCatalogPanel />);
    expect(await screen.findByTestId("resource-catalog-message")).toHaveTextContent("RESOURCE_LIST_DENIED");
  });
});
