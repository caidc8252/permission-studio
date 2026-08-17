import { describe, expect, it } from "vitest";

import {
  addNewRole,
  applyDraftToModel,
  buildImpactDiff,
  buildPermissionChange,
  createEmptyDraft,
  deleteRole,
  discardContractDraft,
  discardDraftItem,
  discardRoleDraft,
  renameExistingRole,
  setContractOwnerMembership,
  setExistingRoleNames,
  setRolePermissionMembership,
  updateNewRole,
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

  it("renames an existing role while preserving its permissions and protocol identity", () => {
    const renamed = renameExistingRole(
      createEmptyDraft(),
      model,
      "preset_ops",
      "preset_operations",
    );
    const changed = setRolePermissionMembership(renamed, model, "preset_ops", [
      "orders.manage",
      "orders.view",
    ]);
    const projected = applyDraftToModel(model, changed);
    const impact = buildImpactDiff(model, changed);
    const change = buildPermissionChange(model, changed, {
      requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
      title: "chore(permissions): rename operations role",
      reason: "统一运营角色编码并保留现有权限配置",
    });

    expect(projected.roles.find((role) => role.code === "preset_operations")).toMatchObject({
      roleId: model.roles[0]!.roleId,
      permissionCodes: ["orders.manage", "orders.view"],
    });
    expect(projected.roles.some((role) => role.code === "preset_ops")).toBe(false);
    expect(impact.renamedRoles).toEqual([{ oldCode: "preset_ops", newCode: "preset_operations" }]);
    expect(change.roleChanges).toEqual([
      {
        roleCode: "preset_ops",
        newRoleCode: "preset_operations",
        add: ["orders.manage"],
        remove: [],
      },
    ]);
  });

  it("rejects a renamed role code occupied by a new draft role", () => {
    const draft = addNewRole(createEmptyDraft(), model, {
      roleId: 99,
      code: "preset_auditor",
      names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
      permissionCodes: [],
    });

    expect(() => renameExistingRole(draft, model, "preset_ops", "preset_auditor")).toThrow(
      "角色编码已存在",
    );
  });

  it("updates existing role names in the preview and change protocol", () => {
    const names = { en: "Operations Admin", "zh-CN": "运营管理员", ja: "運用管理者" };
    const draft = setExistingRoleNames(createEmptyDraft(), model, "preset_ops", names);
    const projected = applyDraftToModel(model, draft);
    const impact = buildImpactDiff(model, draft);
    const change = buildPermissionChange(model, draft, {
      requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
      title: "chore(permissions): rename operations role",
      reason: "更新运营角色的中文、英文和日文显示名称",
    });

    expect(projected.translations.en["role.ops"]).toBe("Operations Admin");
    expect(projected.translations["zh-CN"]["role.ops"]).toBe("运营管理员");
    expect(projected.translations.ja["role.ops"]).toBe("運用管理者");
    expect(impact.updatedRoleNames).toEqual([
      {
        roleCode: "preset_ops",
        oldNames: { en: "Operations", "zh-CN": "运营", ja: "運用" },
        newNames: names,
      },
    ]);
    expect(change.roleChanges).toEqual([
      { roleCode: "preset_ops", roleNameKey: "role.ops", names, add: [], remove: [] },
    ]);
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

  it("updates a draft-created role while excluding itself from duplicate checks", () => {
    const draft = addNewRole(createEmptyDraft(), model, {
      roleId: 99,
      code: "preset_auditor",
      names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
      permissionCodes: ["orders.view"],
    });

    const updated = updateNewRole(draft, model, "preset_auditor", {
      roleId: 98,
      code: "preset_reviewer",
      names: { en: "Reviewer", "zh-CN": "复核员", ja: "レビュー担当者" },
      permissionCodes: ["orders.manage"],
    });

    expect(updated.newRoles).toEqual([
      {
        roleId: 98,
        code: "preset_reviewer",
        names: { en: "Reviewer", "zh-CN": "复核员", ja: "レビュー担当者" },
        permissionCodes: ["orders.manage"],
      },
    ]);
  });

  it("deletes an existing role while clearing its other changes", () => {
    const renamed = renameExistingRole(
      createEmptyDraft(),
      model,
      "preset_ops",
      "preset_operations",
    );
    const changed = setRolePermissionMembership(renamed, model, "preset_ops", ["orders.manage"]);
    const deleted = deleteRole(changed, model, "preset_ops");
    const impact = buildImpactDiff(model, deleted);
    const change = buildPermissionChange(model, deleted, {
      requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
      title: "chore(permissions): delete operations role",
      reason: "删除已停用的运营角色及其多语言资源",
    });

    expect(applyDraftToModel(model, deleted).roles).toEqual([]);
    expect(deleted).toMatchObject({
      deletedRoleCodes: ["preset_ops"],
      roleRenames: {},
      rolePermissions: {},
    });
    expect(impact.deletedRoleCodes).toEqual(["preset_ops"]);
    expect(change.deletedRoleCodes).toEqual(["preset_ops"]);
    expect(change.roleChanges).toEqual([]);
    expect(discardRoleDraft(deleted, "preset_ops")).toEqual(createEmptyDraft());
  });

  it("removes a draft-created role instead of creating a deletion change", () => {
    const added = addNewRole(createEmptyDraft(), model, {
      roleId: 99,
      code: "preset_auditor",
      names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
      permissionCodes: [],
    });

    expect(deleteRole(added, model, "preset_auditor")).toEqual(createEmptyDraft());
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
