import { describe, expect, it } from "vitest";

import { createEmptyDraft, setRolePermissionMembership } from "@/src/domain/draft";
import { buildRoleEditorView } from "@/src/domain/editor-view";
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
