import { describe, expect, it } from "vitest";

import { permissionStudioModelSchema } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

describe("permissionStudioModelSchema", () => {
  it("accepts a complete strict model", () => {
    const parsed = permissionStudioModelSchema.parse(validModel);

    expect(parsed.sourceSha).toBe(validModel.sourceSha);
    expect(parsed.permissionCodes).toEqual(["orders.manage", "orders.view"]);
  });

  it("rejects malformed SHAs and unknown top-level keys", () => {
    expect(() =>
      permissionStudioModelSchema.parse({ ...validModel, sourceSha: "short" }),
    ).toThrow();
    expect(() => permissionStudioModelSchema.parse({ ...validModel, unexpected: true })).toThrow();
  });

  it("rejects registry keys that disagree with their embedded codes", () => {
    expect(() =>
      permissionStudioModelSchema.parse({
        ...validModel,
        permissionRegistry: {
          ...validModel.permissionRegistry,
          "orders.view": {
            ...validModel.permissionRegistry["orders.view"],
            code: "orders.other",
          },
        },
      }),
    ).toThrow(/registry key/i);
  });

  it("rejects unknown permission and contract references", () => {
    expect(() =>
      permissionStudioModelSchema.parse({
        ...validModel,
        roles: [
          {
            ...validModel.roles[0],
            permissionCodes: ["missing.permission"],
          },
        ],
      }),
    ).toThrow(/unknown permission/i);
    expect(() =>
      permissionStudioModelSchema.parse({
        ...validModel,
        contractMenus: {
          ...validModel.contractMenus,
          UNKNOWN: ["orders"],
        },
      }),
    ).toThrow(/unknown contract/i);
  });

  it("rejects incomplete availability and plan-policy references", () => {
    expect(() =>
      permissionStudioModelSchema.parse({
        ...validModel,
        permissionAvailability: { "missing.permission": [{ contract: "ISO" }] },
      }),
    ).toThrow(/availability.*unknown permission/i);
    expect(() =>
      permissionStudioModelSchema.parse({
        ...validModel,
        permissionAvailability: { "orders.view": [{ contract: "UNKNOWN" }] },
      }),
    ).toThrow(/availability.*unknown contract/i);
    expect(() =>
      permissionStudioModelSchema.parse({
        ...validModel,
        contractPlanPolicies: {
          ISO: {
            plans: ["STANDARD"],
            permissionPlans: { "orders.manage": ["UNKNOWN"] },
          },
        },
      }),
    ).toThrow(/unknown plan/i);
  });
});
