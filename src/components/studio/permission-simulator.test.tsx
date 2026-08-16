// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PermissionSimulator } from "@/src/components/studio/permission-simulator";
import { createEmptyDraft, setRolePermissionMembership } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;
const empty = createEmptyDraft();
const draftAddingOrdersManage = setRolePermissionMembership(empty, model, "preset_ops", [
  "orders.manage",
  "orders.view",
]);

afterEach(cleanup);

describe("PermissionSimulator", () => {
  it("calculates simulation from the draft-applied model", () => {
    render(<PermissionSimulator model={model} draft={draftAddingOrdersManage} />);

    expect(screen.getByText("正在预览草稿")).toBeVisible();
    expect(screen.getByLabelText("orders.manage evidence")).toHaveTextContent("Roles: preset_ops");
  });

  it("labels membership type separately from roles", () => {
    render(<PermissionSimulator model={model} draft={empty} />);

    expect(screen.getByRole("group", { name: "成员类型（仅用于模拟）" })).toBeVisible();
    expect(screen.getByRole("group", { name: "角色组合" })).toBeVisible();
  });
});
