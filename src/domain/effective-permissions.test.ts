import { describe, expect, it } from "vitest";

import { explainEffectivePermissions } from "@/src/domain/effective-permissions";
import type { EffectivePermissionInput } from "@/src/domain/model";

const baseInput: EffectivePermissionInput = {
  permissionCodes: ["orders.view", "orders.manage", "orders.refund"],
  contractScope: {
    ADMIN: ["orders.view", "orders.manage", "orders.refund"],
    ISO: ["orders.view", "orders.manage"],
  },
  contractPlanPolicies: {
    ISO: {
      plans: ["STANDARD", "ENTERPRISE"],
      permissionPlans: {
        "orders.manage": ["ENTERPRISE"],
      },
    },
  },
  entitlements: [{ contractType: "ISO", plan: "STANDARD" }],
  roles: [
    {
      code: "preset_ops",
      permissionCodes: ["orders.manage", "orders.view"],
    },
    {
      code: "preset_finance",
      permissionCodes: ["orders.refund"],
    },
  ],
  selectedRoleCodes: ["preset_ops"],
  membershipType: "MEMBER",
};

describe("explainEffectivePermissions", () => {
  it("intersects selected role grants with plan-filtered contract scope", () => {
    const result = explainEffectivePermissions(baseInput);

    expect(result.effectiveCodes).toEqual(["orders.view"]);
    expect(result.decisions["orders.view"]).toMatchObject({
      effective: true,
      roleGranted: true,
      contractGranted: true,
      blockedByPlan: false,
      grantingContracts: ["ISO"],
      grantingRoles: ["preset_ops"],
    });
    expect(result.decisions["orders.manage"]).toMatchObject({
      effective: false,
      roleGranted: true,
      contractGranted: false,
      blockedByPlan: true,
      grantingContracts: [],
      grantingRoles: ["preset_ops"],
    });
  });

  it("fails closed only for controlled permissions when the plan is missing or unknown", () => {
    const missingPlan = explainEffectivePermissions({
      ...baseInput,
      entitlements: [{ contractType: "ISO", plan: null }],
    });
    const unknownPlan = explainEffectivePermissions({
      ...baseInput,
      entitlements: [{ contractType: "ISO", plan: "UNKNOWN" }],
    });

    expect(missingPlan.effectiveCodes).toEqual(["orders.view"]);
    expect(unknownPlan.effectiveCodes).toEqual(["orders.view"]);
    expect(missingPlan.decisions["orders.manage"].blockedByPlan).toBe(true);
    expect(unknownPlan.decisions["orders.manage"].blockedByPlan).toBe(true);
  });

  it("unions independently entitled contracts and selected roles", () => {
    const result = explainEffectivePermissions({
      ...baseInput,
      entitlements: [
        { contractType: "ISO", plan: "STANDARD" },
        { contractType: "ADMIN", plan: null },
      ],
      selectedRoleCodes: ["preset_finance", "preset_ops"],
    });

    expect(result.effectiveCodes).toEqual(["orders.manage", "orders.refund", "orders.view"]);
    expect(result.decisions["orders.manage"].grantingContracts).toEqual(["ADMIN"]);
    expect(result.decisions["orders.refund"].grantingRoles).toEqual(["preset_finance"]);
  });

  it("lets ADMIN membership bypass roles but not contract or plan scope", () => {
    const result = explainEffectivePermissions({
      ...baseInput,
      selectedRoleCodes: [],
      membershipType: "ADMIN",
    });

    expect(result.effectiveCodes).toEqual(["orders.view"]);
    expect(result.decisions["orders.view"]).toMatchObject({
      effective: true,
      roleGranted: false,
      bypassedByAdminMembership: true,
    });
    expect(result.decisions["orders.manage"]).toMatchObject({
      effective: false,
      bypassedByAdminMembership: true,
      blockedByPlan: true,
    });
    expect(result.decisions["orders.refund"].effective).toBe(false);
  });

  it("returns an empty effective set for unknown contracts, roles, or no roles", () => {
    expect(
      explainEffectivePermissions({
        ...baseInput,
        entitlements: [{ contractType: "UNKNOWN", plan: null }],
      }).effectiveCodes,
    ).toEqual([]);
    expect(
      explainEffectivePermissions({
        ...baseInput,
        selectedRoleCodes: ["preset_unknown"],
      }).effectiveCodes,
    ).toEqual([]);
    expect(
      explainEffectivePermissions({
        ...baseInput,
        selectedRoleCodes: [],
      }).effectiveCodes,
    ).toEqual([]);
  });

  it("deduplicates deterministically without mutating input", () => {
    const input: EffectivePermissionInput = {
      ...baseInput,
      permissionCodes: ["orders.view", "orders.manage", "orders.view"],
      selectedRoleCodes: ["preset_ops", "preset_ops"],
      entitlements: [
        { contractType: "ISO", plan: "ENTERPRISE" },
        { contractType: "ISO", plan: "ENTERPRISE" },
      ],
    };
    const before = structuredClone(input);

    const result = explainEffectivePermissions(input);

    expect(result.effectiveCodes).toEqual(["orders.manage", "orders.view"]);
    expect(result.decisions["orders.view"].grantingContracts).toEqual(["ISO"]);
    expect(result.decisions["orders.view"].grantingRoles).toEqual(["preset_ops"]);
    expect(input).toEqual(before);
  });
});
