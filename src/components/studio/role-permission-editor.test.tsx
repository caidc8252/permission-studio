// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RolePermissionEditor } from "@/src/components/studio/role-permission-editor";
import { addNewRole, createEmptyDraft, setRolePermissionMembership } from "@/src/domain/draft";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RolePermissionEditor", () => {
  it("edits only the selected role and preserves other role changes", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const draft = setRolePermissionMembership(createEmptyDraft(), model, "preset_support", [
      "orders.manage",
    ]);
    render(<RolePermissionEditor model={model} draft={draft} onDraftChange={onDraftChange} />);

    expect(
      within(screen.getByRole("region", { name: "可添加权限" })).getByRole("heading", {
        name: "订单 1 / 2",
      }),
    ).toBeVisible();
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

  it("adds one permission directly from its row", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <RolePermissionEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    expect(
      within(screen.getByRole("region", { name: "可添加权限" })).getByRole("heading", {
        name: "订单 1 / 2",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "添加：管理订单" }));

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rolePermissions: { preset_ops: ["orders.manage", "orders.view"] },
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
    expect(
      screen.getByRole("button", { name: "运营（preset_ops）", description: "运营角色。" }),
    ).toBeVisible();
    const roleCard = screen.getByRole("button", { name: "运营（preset_ops）" });
    expect(within(roleCard).getByText("运营角色。")).toHaveAttribute("title", "运营角色。");
    expect(within(roleCard).getByText("1 项权限")).toBeVisible();
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

    expect(screen.getByRole("button", { name: "客服（preset_support）" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "运营（preset_ops）" })).not.toBeInTheDocument();
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
    await user.type(screen.getByRole("textbox", { name: "新角色中文描述" }), "查看审计记录");
    await user.type(
      screen.getByRole("textbox", { name: "新角色英文描述" }),
      "Reviews audit records",
    );
    await user.type(
      screen.getByRole("textbox", { name: "新角色日文描述" }),
      "監査記録を確認します",
    );
    await user.type(screen.getByRole("spinbutton", { name: "新角色 ID" }), "99");

    const permissions = screen.getByRole("region", { name: "新角色的初始权限" });
    await user.selectOptions(
      within(permissions).getByRole("combobox", { name: "权限分组" }),
      "订单",
    );
    expect(within(permissions).queryByText("邀请用户")).not.toBeInTheDocument();
    await user.click(within(permissions).getByRole("button", { name: "添加：查看订单" }));
    await user.click(screen.getByRole("button", { name: "添加到变更草稿" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      newRoles: [
        {
          roleId: 99,
          code: "preset_auditor",
          names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
          descriptions: {
            en: "Reviews audit records",
            "zh-CN": "查看审计记录",
            ja: "監査記録を確認します",
          },
          permissionCodes: ["orders.view"],
        },
      ],
      roleRenames: {},
      roleNames: {},
      rolePermissions: {},
      contractMenus: {},
      contractWidgets: {},
    });
  });

  it("fills English and Japanese names by translating the Chinese name on demand", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn(async () => Response.json({ data: { en: "Auditor", ja: "監査担当者" } }));
    vi.stubGlobal("fetch", fetcher);
    render(
      <RolePermissionEditor model={model} draft={createEmptyDraft()} onDraftChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "新增角色" }));
    const translate = screen.getByRole("button", { name: "将中文名称翻译为英文和日文" });
    expect(translate).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "新角色中文名称" }), "审计员");
    await user.click(translate);

    expect(fetcher).toHaveBeenCalledWith("/api/translate-role-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "审计员" }),
    });
    expect(screen.getByRole("textbox", { name: "新角色英文名称" })).toHaveValue("Auditor");
    expect(screen.getByRole("textbox", { name: "新角色日文名称" })).toHaveValue("監査担当者");
    expect(screen.getByText("已填充英文和日文名称")).toBeVisible();
  });

  it("fills English and Japanese descriptions by translating the Chinese description", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn(async () =>
      Response.json({
        data: { en: "Reviews audit records", ja: "監査記録を確認します" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    render(
      <RolePermissionEditor model={model} draft={createEmptyDraft()} onDraftChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "新增角色" }));
    const translate = screen.getByRole("button", { name: "将中文描述翻译为英文和日文" });
    expect(translate).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "新角色中文描述" }), "查看审计记录");
    await user.click(translate);

    expect(fetcher).toHaveBeenCalledWith("/api/translate-role-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "查看审计记录" }),
    });
    expect(screen.getByRole("textbox", { name: "新角色英文描述" })).toHaveValue(
      "Reviews audit records",
    );
    expect(screen.getByRole("textbox", { name: "新角色日文描述" })).toHaveValue(
      "監査記録を確認します",
    );
    expect(screen.getByText("已填充英文和日文描述")).toBeVisible();
  });

  it("reopens and updates a role created in the current draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const draft = addNewRole(createEmptyDraft(), model, {
      roleId: 99,
      code: "preset_auditor",
      names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
      descriptions: {
        en: "Reviews audit records",
        "zh-CN": "查看审计记录",
        ja: "監査記録を確認します",
      },
      permissionCodes: ["orders.view"],
    });
    render(
      <RolePermissionEditor
        model={model}
        draft={draft}
        selectedRoleCode="preset_auditor"
        onDraftChange={onDraftChange}
      />,
    );

    expect(screen.queryByRole("button", { name: "编辑角色" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "角色操作：审计员" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑角色" }));
    const dialog = screen.getByRole("dialog", { name: "编辑角色" });
    expect(within(dialog).getByRole("textbox", { name: "新角色编码" })).toHaveValue(
      "preset_auditor",
    );
    const transfer = within(dialog).getByRole("region", { name: "新角色的初始权限" });
    expect(within(transfer).getByRole("region", { name: "初始权限" })).toHaveTextContent(
      "查看订单",
    );

    const chineseName = within(dialog).getByRole("textbox", { name: "新角色中文名称" });
    await user.clear(chineseName);
    await user.type(chineseName, "复核员");
    await user.click(within(dialog).getByRole("button", { name: "保存角色修改" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      ...draft,
      newRoles: [
        {
          ...draft.newRoles[0],
          names: { en: "Auditor", "zh-CN": "复核员", ja: "監査担当者" },
        },
      ],
    });
  });

  it("edits an existing role code and localized names with duplicate validation", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <RolePermissionEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "角色操作：运营" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑角色" }));
    const dialog = screen.getByRole("dialog", { name: "编辑角色" });
    const input = within(dialog).getByRole("textbox", { name: "修改后的角色编码" });
    await user.clear(input);
    await user.type(input, "preset_support");
    await user.click(within(dialog).getByRole("button", { name: "保存角色修改" }));
    expect(within(dialog).getByText("角色编码已存在")).toBeVisible();

    await user.clear(input);
    await user.type(input, "preset_operations");
    const chineseName = within(dialog).getByRole("textbox", { name: "角色中文名称" });
    await user.clear(chineseName);
    await user.type(chineseName, "运营管理");
    await user.click(within(dialog).getByRole("button", { name: "保存角色修改" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      newRoles: [],
      roleRenames: { preset_ops: "preset_operations" },
      roleNames: {
        preset_ops: { en: "Operations", "zh-CN": "运营管理", ja: "運用" },
      },
      rolePermissions: {},
      contractMenus: {},
      contractWidgets: {},
    });
  });

  it("edits and translates localized names and descriptions for an existing role", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const fetcher = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      return Response.json(
        body.text === "运营"
          ? { data: { en: "Operations Admin", ja: "運用管理" } }
          : { data: { en: "Manages daily operations.", ja: "日々の運用を管理します。" } },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    render(
      <RolePermissionEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "角色操作：运营" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑角色" }));
    const dialog = screen.getByRole("dialog", { name: "编辑角色" });
    expect(within(dialog).getByRole("textbox", { name: "角色中文描述" })).toHaveValue("运营角色。");

    await user.click(within(dialog).getByRole("button", { name: "将中文名称翻译为英文和日文" }));
    const chineseDescription = within(dialog).getByRole("textbox", { name: "角色中文描述" });
    await user.clear(chineseDescription);
    await user.type(chineseDescription, "管理日常运营。");
    await user.click(within(dialog).getByRole("button", { name: "将中文描述翻译为英文和日文" }));

    expect(within(dialog).getByRole("textbox", { name: "角色英文名称" })).toHaveValue(
      "Operations Admin",
    );
    expect(within(dialog).getByRole("textbox", { name: "角色日文名称" })).toHaveValue("運用管理");
    expect(within(dialog).getByRole("textbox", { name: "角色英文描述" })).toHaveValue(
      "Manages daily operations.",
    );
    expect(within(dialog).getByRole("textbox", { name: "角色日文描述" })).toHaveValue(
      "日々の運用を管理します。",
    );
    await user.click(within(dialog).getByRole("button", { name: "保存角色修改" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      ...createEmptyDraft(),
      roleNames: {
        preset_ops: { en: "Operations Admin", "zh-CN": "运营", ja: "運用管理" },
      },
      roleDescriptions: {
        preset_ops: {
          en: "Manages daily operations.",
          "zh-CN": "管理日常运营。",
          ja: "日々の運用を管理します。",
        },
      },
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/translate-role-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "运营" }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/translate-role-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "管理日常运营。" }),
    });
  });

  it("falls back to an existing role when the selected new role is discarded", () => {
    const draft = addNewRole(createEmptyDraft(), model, {
      roleId: 99,
      code: "preset_1312",
      names: { en: "Temporary", "zh-CN": "临时角色", ja: "一時ロール" },
      permissionCodes: [],
    });
    const onSelectedRoleCodeChange = vi.fn();
    const { rerender } = render(
      <RolePermissionEditor
        model={model}
        draft={draft}
        selectedRoleCode="preset_1312"
        onSelectedRoleCodeChange={onSelectedRoleCodeChange}
        onDraftChange={vi.fn()}
      />,
    );

    rerender(
      <RolePermissionEditor
        model={model}
        draft={createEmptyDraft()}
        selectedRoleCode="preset_1312"
        onSelectedRoleCodeChange={onSelectedRoleCodeChange}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "运营" })).toBeVisible();
    expect(onSelectedRoleCodeChange).toHaveBeenLastCalledWith("preset_ops");
  });

  it("adds an existing role deletion to the draft after confirmation", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <RolePermissionEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "角色操作：运营" }));
    await user.click(screen.getByRole("menuitem", { name: "删除角色" }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("不会自动迁移线上已有的角色绑定"),
    );
    expect(onDraftChange).toHaveBeenCalledWith({
      ...createEmptyDraft(),
      deletedRoleCodes: ["preset_ops"],
    });
  });

  it("removes a newly created role from the draft instead of recording a deletion", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const draft = addNewRole(createEmptyDraft(), model, {
      roleId: 99,
      code: "preset_auditor",
      names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
      permissionCodes: [],
    });
    render(
      <RolePermissionEditor
        model={model}
        draft={draft}
        selectedRoleCode="preset_auditor"
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "角色操作：审计员" }));
    await user.click(screen.getByRole("menuitem", { name: "删除角色" }));

    expect(onDraftChange).toHaveBeenCalledWith(createEmptyDraft());
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

  it("keeps role dialogs open when their backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(
      <RolePermissionEditor model={model} draft={createEmptyDraft()} onDraftChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "新增角色" }));
    const newRoleDialog = screen.getByRole("dialog", { name: "新增角色" });
    fireEvent.click(newRoleDialog);
    expect(newRoleDialog).toBeVisible();

    await user.click(screen.getByRole("button", { name: "关闭新增角色弹窗" }));
    await user.click(screen.getByRole("button", { name: "角色操作：运营" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑角色" }));
    const editCodeDialog = screen.getByRole("dialog", { name: "编辑角色" });
    fireEvent.click(editCodeDialog);
    expect(editCodeDialog).toBeVisible();
  });
});
