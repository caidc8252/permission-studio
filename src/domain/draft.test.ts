import { describe, expect, it } from "vitest";

import {
  addNewRole,
  applyDraftToModel,
  buildImpactDiff,
  buildPermissionChange,
  createEmptyDraft,
  discardContractDraft,
  discardDraftItem,
  discardRoleDraft,
  setContractOwnerMembership,
  setRolePermissionMembership,
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

  it("sets a role permission batch deterministically and removes empty overrides", () => {
    const empty = createEmptyDraft();
    const added = setRolePermissionMembership(empty, model, "preset_ops", [
      "orders.view",
      "orders.manage",
      "orders.manage",
    ]);
    expect(added.rolePermissions.preset_ops).toEqual(["orders.manage", "orders.view"]);

    const baseline = setRolePermissionMembership(
      added,
      model,
      "preset_ops",
      model.roles[0]!.permissionCodes,
    );
    expect(baseline.rolePermissions).toEqual({});
  });

  it("adds a role with initial permissions and includes it in the change protocol", () => {
    const draft = addNewRole(createEmptyDraft(), model, {
      roleId: 99,
      code: "preset_auditor",
      names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
      permissionCodes: ["orders.view"],
    });
    const projected = applyDraftToModel(model, draft);

    expect(projected.roles.find((role) => role.code === "preset_auditor")).toMatchObject({
      roleId: 99,
      roleName: "role.presetAuditor",
      remark: "role.presetAuditorDesc",
      permissionCodes: ["orders.view"],
    });
    expect(projected.translations["zh-CN"]["role.presetAuditor"]).toBe("审计员");
    expect(projected.translations.en["role.presetAuditor"]).toBe("Auditor");
    expect(projected.translations.ja["role.presetAuditor"]).toBe("監査担当者");
    expect(buildImpactDiff(model, draft)).toMatchObject({
      addedRoles: [expect.objectContaining({ code: "preset_auditor" })],
      addedRolePermissions: [{ roleCode: "preset_auditor", code: "orders.view" }],
    });
    expect(
      buildPermissionChange(model, draft, {
        requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
        title: "chore(permissions): add auditor role",
        reason: "新增审计角色并分配订单查看权限",
      }).newRoles,
    ).toEqual([
      {
        roleId: 99,
        code: "preset_auditor",
        names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
        permissionCodes: ["orders.view"],
      },
    ]);
  });

  it("sets a contract owner batch deterministically and removes empty overrides", () => {
    const added = setContractOwnerMembership(createEmptyDraft(), model, "ISO", "menu", []);
    expect(added.contractMenus.ISO).toEqual([]);

    const baseline = setContractOwnerMembership(
      added,
      model,
      "ISO",
      "menu",
      model.contractMenus.ISO ?? [],
    );
    expect(baseline.contractMenus).toEqual({});
  });

  it("discards only one changed contract", () => {
    const empty = createEmptyDraft();
    const changed = setContractOwnerMembership(empty, model, "ISO", "menu", []);
    expect(discardContractDraft(changed, "ISO")).toEqual(createEmptyDraft());
  });

  it("discards one item while preserving other changes for the same owner", () => {
    const changedRole = setRolePermissionMembership(createEmptyDraft(), model, "preset_ops", [
      "orders.manage",
    ]);
    const changedMenu = setContractOwnerMembership(changedRole, model, "ISO", "menu", []);

    expect(discardRoleDraft(changedMenu, "preset_ops").rolePermissions).toEqual({});
    expect(
      discardDraftItem(changedMenu, model, {
        kind: "menu",
        ownerCode: "ISO",
        code: "orders",
      }),
    ).toMatchObject({
      contractMenus: {},
      rolePermissions: { preset_ops: ["orders.manage"] },
    });
    expect(
      discardDraftItem(changedMenu, model, {
        kind: "permission",
        ownerCode: "preset_ops",
        code: "orders.manage",
      }),
    ).toMatchObject({ rolePermissions: { preset_ops: [] } });
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
    expect(() =>
      setRolePermissionMembership(createEmptyDraft(), model, "preset_ops", ["missing.permission"]),
    ).toThrow(/unknown permission/i);
    expect(() =>
      discardDraftItem(createEmptyDraft(), model, {
        kind: "permission",
        ownerCode: "preset_ops",
        code: "missing.permission",
      }),
    ).toThrow(/unknown permission/i);
  });

  it("builds a normalized versioned change from the draft", () => {
    const draft = toggleRolePermission(createEmptyDraft(), model, "preset_ops", "orders.manage");

    expect(
      buildPermissionChange(model, draft, {
        requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
        title: "chore(permissions): grant report export",
        reason: "为运营角色增加订单管理权限",
      }),
    ).toEqual({
      version: 1,
      requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
      baseSha: model.sourceSha,
      title: "chore(permissions): grant report export",
      reason: "为运营角色增加订单管理权限",
      newRoles: [],
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
