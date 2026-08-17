import { describe, expect, it } from "vitest";

import { createEmptyDraft, setRolePermissionMembership } from "@/src/domain/draft";
import {
  buildContractEditorView,
  buildPermissionTransferItems,
  buildRoleEditorView,
} from "@/src/domain/editor-view";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;

describe("role editor view", () => {
  it("projects translated assigned and available permissions for one preset role", () => {
    const view = buildRoleEditorView(model, createEmptyDraft(), "preset_ops");

    expect(view.assigned.map(({ id }) => id)).toEqual(["orders.view"]);
    expect(view.available.map(({ id }) => id)).toEqual(["orders.manage"]);
    expect(view.assigned[0]).toMatchObject({
      label: "查看订单",
      group: "订单",
      kind: "permission",
    });
    expect(view).toMatchObject({
      roleCode: "preset_ops",
      roleLabel: "运营",
      roleDescription: "运营角色。",
    });
  });

  it("uses the draft membership and keeps groups in menu order", () => {
    const expanded = {
      ...model,
      permissionCodes: ["orders.manage", "orders.view", "users.invite"],
      menuRegistry: {
        ...model.menuRegistry,
        users: {
          menuCode: "users",
          title: "menu.users",
          parentMenuCode: null,
          path: "/users",
          icon: "users",
          order: 5,
        },
      },
      permissionRegistry: {
        ...model.permissionRegistry,
        "users.invite": {
          code: "users.invite",
          belongToMenuCode: "users",
          label: "permission.users.invite",
          desc: "permission.users.inviteDesc",
        },
      },
      translations: {
        ...model.translations,
        "zh-CN": {
          ...model.translations["zh-CN"],
          "menu.users": "用户",
          "permission.users.invite": "邀请用户",
          "permission.users.inviteDesc": "邀请新的成员。",
        },
      },
    } satisfies PermissionStudioModel;
    const draft = setRolePermissionMembership(createEmptyDraft(), expanded, "preset_ops", [
      "users.invite",
    ]);

    const view = buildRoleEditorView(expanded, draft, "preset_ops");

    expect(view.assigned.map(({ id }) => id)).toEqual(["users.invite"]);
    expect(view.available.map(({ id }) => id)).toEqual(["orders.manage", "orders.view"]);
    expect(view.available.map(({ group }) => group)).toEqual(["订单", "订单"]);
  });

  it("collects all widget permissions into one Widget group", () => {
    const widgetModel = {
      ...model,
      permissionCodes: [...model.permissionCodes, "widget.quick", "widget.status"],
      permissionRegistry: {
        ...model.permissionRegistry,
        "widget.quick": {
          code: "widget.quick",
          belongToMenuCode: "widget.quick",
          label: "widget.quick",
          desc: "widget.quickDesc",
        },
        "widget.status": {
          code: "widget.status",
          belongToMenuCode: "widget.status",
          label: "widget.status",
          desc: "widget.statusDesc",
        },
      },
    } as unknown as PermissionStudioModel;

    const items = buildPermissionTransferItems(widgetModel, ["widget.quick", "widget.status"]);

    expect(items.map(({ group }) => group)).toEqual(["Widget", "Widget"]);
  });

  it("rejects a non-preset role", () => {
    const modelWithPrivateRole = {
      ...model,
      roles: [
        ...model.roles,
        {
          roleId: 11,
          code: "custom_ops",
          roleName: "role.customOps",
          remark: "role.customOpsDesc",
          permissionCodes: [],
        },
      ],
    } satisfies PermissionStudioModel;

    expect(() =>
      buildRoleEditorView(modelWithPrivateRole, createEmptyDraft(), "custom_ops"),
    ).toThrow("not editable");
  });
});

describe("contract editor view", () => {
  const modelWithNestedMenuAndWidget = {
    ...model,
    permissionCodes: [...model.permissionCodes, "widget.quick"],
    menuRegistry: {
      ...model.menuRegistry,
      "orders.history": {
        menuCode: "orders.history",
        title: "menu.orders.history",
        parentMenuCode: "orders",
        path: "/orders/history",
        icon: "history",
        order: 1,
      },
    },
    permissionRegistry: {
      ...model.permissionRegistry,
      "widget.quick": {
        code: "widget.quick",
        belongToMenuCode: "widget.quick",
        label: "widget.quick",
        desc: "widget.quickDesc",
      },
    },
    contractMenus: { ...model.contractMenus, ISO: ["orders", "orders.history"] },
    contractWidgets: { ...model.contractWidgets, ISO: ["widget.quick"] },
    translations: {
      ...model.translations,
      "zh-CN": {
        ...model.translations["zh-CN"],
        "menu.orders.history": "订单历史",
        "widget.quick": "快捷组件",
        "widget.quickDesc": "快速访问组件",
      },
    },
  } as unknown as PermissionStudioModel;

  it("flattens the real menu tree and keeps widgets in a separate root group", () => {
    const view = buildContractEditorView(modelWithNestedMenuAndWidget, createEmptyDraft(), "ISO");

    expect(view.assigned).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "orders", kind: "menu", depth: 0 }),
        expect.objectContaining({ id: "orders.history", kind: "menu", depth: 1 }),
        expect.objectContaining({ id: "widget.quick", kind: "widget", group: "Widgets" }),
      ]),
    );
    expect(view.assigned.find(({ id }) => id === "widget.quick")?.depth).toBe(0);
  });

  it("never exposes TEST as editable", () => {
    expect(() => buildContractEditorView(model, createEmptyDraft(), "TEST")).toThrow("read-only");
  });
});
