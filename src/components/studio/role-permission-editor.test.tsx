// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const dragAndDrop = vi.hoisted(() => ({
  combine: vi.fn(
    (...cleanups: Array<() => void>) =>
      () =>
        cleanups.forEach((cleanup) => cleanup()),
  ),
  draggable: vi.fn(() => () => undefined),
  dropTargetForElements: vi.fn(() => () => undefined),
  monitorForElements: vi.fn(() => () => undefined),
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/combine", () => ({
  combine: dragAndDrop.combine,
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: dragAndDrop.draggable,
  dropTargetForElements: dragAndDrop.dropTargetForElements,
  monitorForElements: dragAndDrop.monitorForElements,
}));

import { RolePermissionEditor } from "@/src/components/studio/role-permission-editor";
import { createEmptyDraft, setRolePermissionMembership } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const baseModel = validModel as unknown as PermissionStudioModel;
const model: PermissionStudioModel = {
  ...baseModel,
  roles: [
    ...baseModel.roles,
    {
      roleId: 11,
      code: "preset_support",
      roleName: "role.support",
      remark: "role.supportDesc",
      permissionCodes: [],
    },
    {
      roleId: 12,
      code: "custom_ops",
      roleName: "role.customOps",
      remark: "role.customOpsDesc",
      permissionCodes: [],
    },
  ],
  translations: {
    ...baseModel.translations,
    "zh-CN": {
      ...baseModel.translations["zh-CN"],
      "role.support": "客服",
      "role.supportDesc": "客服角色。",
      "role.customOps": "自定义运营",
      "role.customOpsDesc": "自定义角色。",
    },
  },
};

afterEach(cleanup);

describe("RolePermissionEditor", () => {
  it("edits only the selected role and preserves other role changes", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const draft = setRolePermissionMembership(createEmptyDraft(), model, "preset_support", [
      "orders.manage",
    ]);
    render(<RolePermissionEditor model={model} draft={draft} onDraftChange={onDraftChange} />);

    await user.click(screen.getByRole("checkbox", { name: "管理订单" }));
    await user.click(screen.getByRole("button", { name: "添加已选权限" }));

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rolePermissions: {
          preset_ops: ["orders.manage", "orders.view"],
          preset_support: ["orders.manage"],
        },
      }),
    );
  });

  it("does not render membership types or custom roles as roles", () => {
    render(
      <RolePermissionEditor model={model} draft={createEmptyDraft()} onDraftChange={vi.fn()} />,
    );

    expect(screen.queryByText("ADMIN")).not.toBeInTheDocument();
    expect(screen.queryByText("MEMBER")).not.toBeInTheDocument();
    expect(screen.queryByText("自定义运营")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运营" })).toBeVisible();
  });

  it("filters the sidebar to pending roles when requested", async () => {
    const user = userEvent.setup();
    const draft = setRolePermissionMembership(createEmptyDraft(), model, "preset_support", [
      "orders.manage",
    ]);
    render(<RolePermissionEditor model={model} draft={draft} onDraftChange={vi.fn()} />);

    await user.click(screen.getByRole("checkbox", { name: "仅显示有变更的角色" }));

    expect(screen.getByRole("button", { name: /客服/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "运营" })).not.toBeInTheDocument();
  });
});
