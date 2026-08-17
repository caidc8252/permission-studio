// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
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
  permissionCodes: [...baseModel.permissionCodes, "users.invite"],
  menuRegistry: {
    ...baseModel.menuRegistry,
    users: {
      menuCode: "users",
      title: "menu.users",
      parentMenuCode: null,
      path: "/users",
      icon: "users",
      order: 2,
    },
  },
  permissionRegistry: {
    ...baseModel.permissionRegistry,
    "users.invite": {
      code: "users.invite",
      belongToMenuCode: "users",
      label: "permission.users.invite",
      desc: "permission.users.inviteDesc",
    },
  },
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
      "menu.users": "用户",
      "permission.users.invite": "邀请用户",
      "permission.users.inviteDesc": "邀请用户加入工作区。",
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
    expect(screen.getByRole("button", { name: "运营（preset_ops）" })).toBeVisible();
    expect(screen.getByText("preset_ops")).toBeVisible();
  });

  it("finds a role by its code", async () => {
    const user = userEvent.setup();
    render(
      <RolePermissionEditor model={model} draft={createEmptyDraft()} onDraftChange={vi.fn()} />,
    );

    await user.type(screen.getByRole("searchbox", { name: "搜索角色" }), "preset_support");

    expect(screen.getByRole("button", { name: "客服（preset_support）" })).toBeVisible();
    expect(screen.queryByText("preset_ops")).not.toBeInTheDocument();
  });

  it("filters the sidebar to pending roles when requested", async () => {
    const user = userEvent.setup();
    const draft = setRolePermissionMembership(createEmptyDraft(), model, "preset_support", [
      "orders.manage",
    ]);
    render(<RolePermissionEditor model={model} draft={draft} onDraftChange={vi.fn()} />);

    await user.click(screen.getByRole("checkbox", { name: "仅显示有变更的角色" }));

    expect(screen.getByRole("button", { name: /客服/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /运营/ })).not.toBeInTheDocument();
  });

  it("creates a unique role and assigns initial permissions with the shared transfer editor", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <RolePermissionEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "新增角色" }));
    expect(screen.getByRole("dialog", { name: "新增角色" })).toBeVisible();
    await user.clear(screen.getByRole("textbox", { name: "新角色编码" }));
    await user.type(screen.getByRole("textbox", { name: "新角色编码" }), "preset_auditor");
    await user.type(screen.getByRole("textbox", { name: "新角色中文名称" }), "审计员");
    await user.type(screen.getByRole("textbox", { name: "新角色英文名称" }), "Auditor");
    await user.type(screen.getByRole("textbox", { name: "新角色日文名称" }), "監査担当者");
    await user.type(screen.getByRole("spinbutton", { name: "新角色 ID" }), "99");

    const permissions = screen.getByRole("region", { name: "新角色的初始权限" });
    await user.selectOptions(
      within(permissions).getByRole("combobox", { name: "权限分组" }),
      "订单",
    );
    expect(within(permissions).queryByText("邀请用户")).not.toBeInTheDocument();
    await user.click(within(permissions).getByRole("checkbox", { name: "查看订单" }));
    await user.click(within(permissions).getByRole("button", { name: "添加已选权限" }));
    await user.click(screen.getByRole("button", { name: "添加到变更草稿" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      newRoles: [
        {
          roleId: 99,
          code: "preset_auditor",
          names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
          permissionCodes: ["orders.view"],
        },
      ],
      rolePermissions: {},
      contractMenus: {},
      contractWidgets: {},
    });
  });

  it("shows duplicate errors for existing role identity fields", async () => {
    const user = userEvent.setup();
    render(
      <RolePermissionEditor model={model} draft={createEmptyDraft()} onDraftChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "新增角色" }));
    await user.clear(screen.getByRole("textbox", { name: "新角色编码" }));
    await user.type(screen.getByRole("textbox", { name: "新角色编码" }), "preset_ops");
    await user.type(screen.getByRole("textbox", { name: "新角色中文名称" }), "运营");
    await user.type(screen.getByRole("textbox", { name: "新角色英文名称" }), "Operations");
    await user.type(screen.getByRole("textbox", { name: "新角色日文名称" }), "運用");
    await user.type(screen.getByRole("spinbutton", { name: "新角色 ID" }), "10");
    await user.click(screen.getByRole("button", { name: "添加到变更草稿" }));

    expect(screen.getByText("角色编码已存在")).toBeVisible();
    expect(screen.getByText("中文名称已存在")).toBeVisible();
    expect(screen.getByText("英文名称已存在")).toBeVisible();
    expect(screen.getByText("日文名称已存在")).toBeVisible();
    expect(screen.getByText("角色 ID 已存在")).toBeVisible();
  });

  it("closes the new role dialog without changing the draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <RolePermissionEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "新增角色" }));
    await user.click(screen.getByRole("button", { name: "关闭新增角色弹窗" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDraftChange).not.toHaveBeenCalled();
  });
});
