// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeTray } from "@/src/components/studio/change-tray";
import type { ImpactDiff } from "@/src/domain/draft";

const impactAcrossThreeObjects: ImpactDiff = {
  addedRoles: [],
  deletedRoleCodes: [],
  renamedRoles: [],
  addedRolePermissions: [
    { roleCode: "preset_ops", code: "orders.manage" },
    { roleCode: "preset_support", code: "orders.view" },
  ],
  removedRolePermissions: [{ roleCode: "preset_ops", code: "orders.view" }],
  addedContractOwners: [],
  removedContractOwners: [{ contractType: "ISO", owner: "orders", kind: "menu" }],
  scenarios: ["contract:ISO", "role:preset_ops", "role:preset_support"],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChangeTray", () => {
  it("summarizes cross-object changes and opens review", async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(
      <ChangeTray
        impact={impactAcrossThreeObjects}
        currentObject={{ scenario: "role:preset_ops", label: "运营" }}
        onReview={onReview}
      />,
    );

    expect(screen.getByText("草稿中有 4 项变更")).toBeVisible();
    expect(screen.getByText("新增 2 项 · 修改 0 项 · 移除 2 项")).toBeVisible();
    expect(screen.getByText("当前运营：2 项变更")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看变更" }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("requires confirmation only before discarding the complete draft", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onDiscardAll = vi.fn();
    const onReview = vi.fn();
    const onGeneratePr = vi.fn();
    vi.stubGlobal("confirm", confirm);
    render(
      <ChangeTray
        impact={impactAcrossThreeObjects}
        onDiscardAll={onDiscardAll}
        onReview={onReview}
        onGeneratePr={onGeneratePr}
      />,
    );

    await user.click(screen.getByRole("button", { name: "查看变更" }));
    await user.click(screen.getByRole("button", { name: "生成 Draft PR" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onReview).toHaveBeenCalledOnce();
    expect(onGeneratePr).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "丢弃全部" }));
    expect(onDiscardAll).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "丢弃全部" }));
    expect(onDiscardAll).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("is absent for an empty draft", () => {
    render(
      <ChangeTray
        impact={{
          addedRoles: [],
          deletedRoleCodes: [],
          renamedRoles: [],
          addedRolePermissions: [],
          removedRolePermissions: [],
          addedContractOwners: [],
          removedContractOwners: [],
          scenarios: [],
        }}
        onReview={vi.fn()}
      />,
    );

    expect(screen.queryByRole("region", { name: "变更草稿" })).not.toBeInTheDocument();
  });
});
