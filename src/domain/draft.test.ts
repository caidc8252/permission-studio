import { describe, expect, it } from "vitest";

import {
  applyDraftToModel,
  buildImpactDiff,
  buildPermissionChange,
  createEmptyDraft,
  toggleContractOwner,
  toggleRolePermission,
} from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;

describe("permission drafts", () => {
  it("toggles role permissions without mutating the model", () => {
    const original = structuredClone(model);
    const draft = toggleRolePermission(createEmptyDraft(), model, "preset_ops", "orders.manage");

    expect(draft.rolePermissions.preset_ops).toEqual(["orders.manage", "orders.view"]);
    expect(model).toEqual(original);
    expect(buildImpactDiff(model, draft).addedRolePermissions).toEqual([
      { roleCode: "preset_ops", code: "orders.manage" },
    ]);
  });

  it("toggles contract menu and widget owners and can project the draft", () => {
    const menuDraft = toggleContractOwner(createEmptyDraft(), model, "ISO", "orders", "menu");
    const widgetModel = {
      ...model,
      permissionRegistry: {
        ...model.permissionRegistry,
        "widget.quick.view": {
          code: "widget.quick.view",
          belongToMenuCode: "widget.quick",
          label: "permission.widget.quick.view",
          desc: "permission.widget.quick.viewDesc",
        },
      },
      permissionCodes: [...model.permissionCodes, "widget.quick.view"],
    };
    const widgetDraft = toggleContractOwner(
      menuDraft,
      widgetModel,
      "ISO",
      "widget.quick",
      "widget",
    );
    const projected = applyDraftToModel(widgetModel, widgetDraft);

    expect(projected.contractMenus.ISO).toEqual([]);
    expect(projected.contractWidgets.ISO).toEqual(["widget.quick"]);
    expect(buildImpactDiff(widgetModel, widgetDraft)).toMatchObject({
      removedContractOwners: [{ contractType: "ISO", owner: "orders", kind: "menu" }],
      addedContractOwners: [{ contractType: "ISO", owner: "widget.quick", kind: "widget" }],
    });
  });

  it("rejects unsupported role, contract, permission, owner, and TEST edits", () => {
    expect(() => toggleRolePermission(createEmptyDraft(), model, "missing", "orders.view")).toThrow(
      /unknown role/i,
    );
    expect(() =>
      toggleRolePermission(createEmptyDraft(), model, "preset_ops", "missing.permission"),
    ).toThrow(/unknown permission/i);
    expect(() =>
      toggleContractOwner(createEmptyDraft(), model, "UNKNOWN", "orders", "menu"),
    ).toThrow(/unknown contract/i);
    expect(() => toggleContractOwner(createEmptyDraft(), model, "TEST", "orders", "menu")).toThrow(
      /read-only/i,
    );
    expect(() => toggleContractOwner(createEmptyDraft(), model, "ISO", "missing", "menu")).toThrow(
      /unknown menu/i,
    );
  });

  it("builds a normalized versioned change from the draft", () => {
    const draft = toggleRolePermission(createEmptyDraft(), model, "preset_ops", "orders.manage");

    expect(
      buildPermissionChange(model, draft, {
        requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
        reason: "为运营角色增加订单管理权限",
      }),
    ).toEqual({
      version: 1,
      requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
      baseSha: model.sourceSha,
      reason: "为运营角色增加订单管理权限",
      roleChanges: [
        {
          roleCode: "preset_ops",
          add: ["orders.manage"],
          remove: [],
        },
      ],
      contractChanges: [],
    });
  });
});
