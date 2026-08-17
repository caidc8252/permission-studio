// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/components/health-card", () => ({
  HealthCard: () => <aside aria-label="GitHub 环境">环境状态</aside>,
}));

vi.mock("@/src/components/studio/studio-shell", () => ({
  StudioShell: () => <section aria-label="权限工作台">权限工作台内容</section>,
}));

import HomePage from "@/app/page";

afterEach(cleanup);

describe("HomePage workspace layout", () => {
  it("puts the workbench directly in the page and keeps environment details in a compact corner", () => {
    render(<HomePage />);

    expect(
      screen.queryByRole("heading", { level: 1, name: "Permission Studio" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("从远端 develop 解释权限、验证变更，并在最终确认后创建 Draft PR。"),
    ).not.toBeInTheDocument();

    const utilityBar = screen.getByRole("banner", { name: "应用工具栏" });
    expect(utilityBar).toContainElement(screen.getByLabelText("GitHub 环境"));
    expect(utilityBar).toHaveTextContent("Newland-Payment-Technology-US-Co-Ltd/pep-webapp");
    expect(utilityBar).toHaveTextContent("develop");

    const workbench = screen.getByLabelText("权限工作台");
    expect(workbench.parentElement).toHaveClass("workspace-main");
    expect(workbench.closest(".health-card")).toBeNull();
  });
});
