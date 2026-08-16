import { describe, expect, it } from "vitest";

import { buildWorkbenchView } from "@/src/domain/workbench";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;

describe("buildWorkbenchView", () => {
  it("explains effective, plan-blocked, and visible module states", () => {
    const view = buildWorkbenchView(model, {
      membershipType: "MEMBER",
      entitlements: [{ contractType: "ISO", plan: "STANDARD" }],
      roleCodes: ["preset_ops"],
    });

    expect(view.permissions.find((item) => item.code === "orders.view")?.status).toBe("effective");
    expect(view.permissions.find((item) => item.code === "orders.manage")?.status).toBe(
      "plan-blocked",
    );
    expect(view.visibleMenus.map((item) => item.menuCode)).toContain("orders");
    expect(view.visibleWidgets).toEqual([]);
  });

  it("uses Chinese translations with a code fallback and remains deterministic", () => {
    const untranslated = structuredClone(model);
    delete untranslated.translations["zh-CN"]["permission.orders.manage"];
    const scenario = {
      membershipType: "ADMIN" as const,
      entitlements: [{ contractType: "ISO", plan: "ENTERPRISE" }],
      roleCodes: [],
    };

    const view = buildWorkbenchView(untranslated, scenario);

    expect(view.permissions.find((item) => item.code === "orders.manage")?.label).toBe(
      "orders.manage",
    );
    expect(view.permissions.map((item) => item.code)).toEqual(["orders.manage", "orders.view"]);
    expect(model).toEqual(validModel);
  });
});
