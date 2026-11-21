import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ProjectsPanel } from "../ProjectsPanel";
import { ProjectDetailView } from "../ProjectDetailView";
import { useProjectsStore } from "../state/projects-store";

beforeEach(() => useProjectsStore.setState({ projects: [], activeProjectId: null }));

describe("项目置顶与任务来源筛选 (U1)", () => {
  it("pins a project and lists pinned projects first", () => {
    const older = useProjectsStore.getState().add({ name: "较早项目" });
    useProjectsStore.getState().add({ name: "较新项目" });
    const { container } = render(<ProjectsPanel />);
    // The first grid is 我的项目; the template grid uses the same card classes.
    const grid = () => container.querySelector(".project-grid") as HTMLElement;
    const names = () => [...grid().querySelectorAll(".project-card2__name")].map((node) => node.textContent);
    expect(names()).toEqual(["较新项目", "较早项目"]);

    const card = () => [...grid().querySelectorAll(".project-card2")].find((node) => node.textContent?.includes("较早项目")) as HTMLElement;
    fireEvent.click(within(card()).getByRole("button", { name: "置顶" }));

    expect(useProjectsStore.getState().projects.find((project) => project.id === older.id)?.pinned).toBe(true);
    expect(names()).toEqual(["较早项目", "较新项目"]);
    expect(within(card()).getByRole("button", { name: "取消置顶" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters tasks by the source they actually carry", () => {
    const project = useProjectsStore.getState().add({ name: "来源项目" });
    useProjectsStore.setState({
      projects: [{
        ...project,
        tasks: [
          { id: "t1", title: "手动任务", scope: "personal", source: "manual", status: "pending" },
          { id: "t2", title: "导入任务", scope: "personal", source: "imported", status: "pending" },
        ],
      }],
    });
    render(<ProjectDetailView project={useProjectsStore.getState().projects[0]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "任务" }));
    expect(screen.getByText("手动任务")).toBeInTheDocument();
    expect(screen.getByText("导入任务")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "按来源筛选" }), { target: { value: "imported" } });
    expect(screen.queryByText("手动任务")).toBeNull();
    expect(screen.getByText("导入任务")).toBeInTheDocument();
  });
});
