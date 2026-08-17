import { describe, expect, it } from "vitest";

import { normalizePermissionChange, permissionChangeSchema } from "@/src/domain/change";

const validChange = {
  version: 1,
  requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  title: "chore(permissions): update permission catalogs",
  reason: "为运营角色增加订单查看能力",
  newRoles: [],
  roleChanges: [
    {
      roleCode: "preset_ops",
      add: ["orders.view"],
      remove: [],
    },
  ],
  contractChanges: [],
};

describe("permission change protocol", () => {
  it("trims and preserves a safe PR title", () => {
    expect(
      normalizePermissionChange({
        ...validChange,
        title: "  chore: update permissions  ",
      }).title,
    ).toBe("chore: update permissions");
  });

  it.each(["short", "x".repeat(121), "bad\ntitle", "safe title\u0085suffix"])(
    "rejects PR title %j",
    (title) => {
      expect(() => normalizePermissionChange({ ...validChange, title })).toThrow();
    },
  );

  it("normalizes leaf arrays and removes empty entries", () => {
    expect(
      normalizePermissionChange({
        ...validChange,
        roleChanges: [
          {
            roleCode: "preset_ops",
            add: ["orders.view", "orders.manage", "orders.view"],
            remove: [],
          },
          {
            roleCode: "preset_empty",
            add: [],
            remove: [],
          },
        ],
      }),
    ).toMatchObject({
      roleChanges: [
        {
          roleCode: "preset_ops",
          add: ["orders.manage", "orders.view"],
          remove: [],
        },
      ],
    });
  });

  it("keeps a code-only role rename and rejects duplicate rename targets", () => {
    expect(
      normalizePermissionChange({
        ...validChange,
        roleChanges: [
          {
            roleCode: "preset_ops",
            newRoleCode: "preset_operations",
            add: [],
            remove: [],
          },
        ],
      }).roleChanges,
    ).toEqual([
      {
        roleCode: "preset_ops",
        newRoleCode: "preset_operations",
        add: [],
        remove: [],
      },
    ]);
    expect(() =>
      normalizePermissionChange({
        ...validChange,
        roleChanges: [
          {
            roleCode: "preset_ops",
            newRoleCode: "preset_shared",
            add: [],
            remove: [],
          },
          {
            roleCode: "preset_support",
            newRoleCode: "preset_shared",
            add: [],
            remove: [],
          },
        ],
      }),
    ).toThrow(/duplicate renamed role/i);
  });

  it("normalizes role deletions and rejects delete-modify conflicts", () => {
    expect(
      normalizePermissionChange({
        ...validChange,
        deletedRoleCodes: ["preset_support", "preset_ops"],
        roleChanges: [],
      }).deletedRoleCodes,
    ).toEqual(["preset_ops", "preset_support"]);
    expect(() =>
      normalizePermissionChange({
        ...validChange,
        deletedRoleCodes: ["preset_ops", "preset_ops"],
        roleChanges: [],
      }),
    ).toThrow(/duplicate deleted role/i);
    expect(() =>
      normalizePermissionChange({
        ...validChange,
        deletedRoleCodes: ["preset_ops"],
      }),
    ).toThrow(/cannot also be added or modified/i);
  });

  it("normalizes new roles and rejects duplicate identities", () => {
    expect(
      normalizePermissionChange({
        ...validChange,
        newRoles: [
          {
            roleId: 99,
            code: "preset_auditor",
            names: { en: " Auditor ", "zh-CN": "  审计员  ", ja: " 監査担当者 " },
            permissionCodes: ["orders.view", "orders.view"],
          },
        ],
        roleChanges: [],
      }).newRoles,
    ).toEqual([
      {
        roleId: 99,
        code: "preset_auditor",
        names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
        permissionCodes: ["orders.view"],
      },
    ]);

    for (const duplicate of [
      {
        roleId: 99,
        code: "preset_other",
        names: { en: "Other", "zh-CN": "其他", ja: "その他" },
      },
      {
        roleId: 100,
        code: "preset_auditor",
        names: { en: "Other", "zh-CN": "其他", ja: "その他" },
      },
      {
        roleId: 100,
        code: "preset_other",
        names: { en: "Auditor", "zh-CN": "其他", ja: "その他" },
      },
    ]) {
      expect(() =>
        normalizePermissionChange({
          ...validChange,
          newRoles: [
            {
              roleId: 99,
              code: "preset_auditor",
              names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
              permissionCodes: [],
            },
            { ...duplicate, permissionCodes: [] },
          ],
          roleChanges: [],
        }),
      ).toThrow(/duplicate new role/i);
    }
  });

  it("rejects conflicts, duplicate owners, and empty final changes", () => {
    expect(() =>
      normalizePermissionChange({
        ...validChange,
        roleChanges: [
          {
            roleCode: "preset_ops",
            add: ["orders.view"],
            remove: ["orders.view"],
          },
        ],
      }),
    ).toThrow(/both add and remove/i);
    expect(() =>
      normalizePermissionChange({
        ...validChange,
        roleChanges: [validChange.roleChanges[0], validChange.roleChanges[0]],
      }),
    ).toThrow(/duplicate role/i);
    expect(() =>
      normalizePermissionChange({
        ...validChange,
        roleChanges: [],
      }),
    ).toThrow(/empty change/i);
  });

  it("rejects TEST, non-preset roles, control characters, and malformed metadata", () => {
    expect(() =>
      normalizePermissionChange({
        ...validChange,
        roleChanges: [
          {
            roleCode: "custom_ops",
            add: ["orders.view"],
            remove: [],
          },
        ],
      }),
    ).toThrow(/preset/i);
    expect(() =>
      normalizePermissionChange({
        ...validChange,
        roleChanges: [],
        contractChanges: [
          {
            contractType: "TEST",
            menus: { add: ["orders"], remove: [] },
            widgets: { add: [], remove: [] },
          },
        ],
      }),
    ).toThrow(/TEST/);
    expect(() =>
      normalizePermissionChange({
        ...validChange,
        reason: "valid reason\u0000with control",
      }),
    ).toThrow(/control/i);
    expect(() => permissionChangeSchema.parse({ ...validChange, requestId: "short" })).toThrow();
    expect(() => permissionChangeSchema.parse({ ...validChange, baseSha: "ABC" })).toThrow();
  });

  it("normalizes contract menu and widget changes deterministically", () => {
    expect(
      normalizePermissionChange({
        ...validChange,
        roleChanges: [],
        contractChanges: [
          {
            contractType: "ISO",
            menus: {
              add: ["sales", "orders", "orders"],
              remove: [],
            },
            widgets: {
              add: ["widget.quick"],
              remove: ["widget.old"],
            },
          },
        ],
      }),
    ).toMatchObject({
      contractChanges: [
        {
          contractType: "ISO",
          menus: { add: ["orders", "sales"], remove: [] },
          widgets: {
            add: ["widget.quick"],
            remove: ["widget.old"],
          },
        },
      ],
    });
  });
});
