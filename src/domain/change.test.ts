import { describe, expect, it } from "vitest";

import { normalizePermissionChange, permissionChangeSchema } from "@/src/domain/change";

const validChange = {
  version: 1,
  requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  title: "chore(permissions): update permission catalogs",
  reason: "为运营角色增加订单查看能力",
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
