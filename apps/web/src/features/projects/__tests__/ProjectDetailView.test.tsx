import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectDetailView } from "../ProjectDetailView";
import { useProjectsStore } from "@/features/projects/state/projects-store";
beforeEach(() => useProjectsStore.setState({ projects: [] }));
describe("local project capability boundaries", () => {
  it("retains local navigation and real conversation launch while disabling unimplemented invitations", () => {
    const project = useProjectsStore.getState().add({ name: "Local", cwd: "/workspace" });
    const launch = vi.fn(); const back = vi.fn();
    render(<ProjectDetailView project={project} onBack={back} onStartConversation={launch} />);
    expect(screen.getByText("本地项目 · 云协作尚未开放")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "邀请" })).toBeDisabled();
    expect(screen.getByText(/云协作尚未开放/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "real task" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" })); expect(launch).toHaveBeenCalledWith(project.id, "real task");
    fireEvent.click(screen.getByRole("button", { name: "项目" })); expect(back).toHaveBeenCalledOnce();
  });
  it("does not fabricate uploads or storage quotas", () => {
    const project = useProjectsStore.getState().add({ name: "Local" });
    const prompt = vi.spyOn(window, "prompt").mockImplementation(() => "pretend.pdf");
    render(<ProjectDetailView project={project} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "资产" }));
    const upload = screen.getByRole("button", { name: "上传文件" });
    expect(upload).toBeDisabled(); fireEvent.click(upload);
    expect(prompt).not.toHaveBeenCalled();
    expect(screen.getByText(/元数据估算/)).toBeInTheDocument();
    expect(screen.queryByText(/5.00 GB/)).toBeNull();
    expect(useProjectsStore.getState().projects[0].assets).toHaveLength(0); prompt.mockRestore();
  });
});
