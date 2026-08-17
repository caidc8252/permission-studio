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

  it("uses the selected data locale for permission and module copy", () => {
    const view = buildWorkbenchView(
      model,
      {
        membershipType: "MEMBER",
        entitlements: [{ contractType: "ISO", plan: "STANDARD" }],
        roleCodes: ["preset_ops"],
      },
      "ja",
    );

    expect(view.permissions.find((item) => item.code === "orders.view")).toMatchObject({
      label: "注文を表示",
      description: "注文レコードを表示します。",
      ownerLabel: "注文",
    });
    expect(view.visibleMenus[0]?.title).toBe("注文");
  });

  it("projects final modules from effective permissions instead of contracts alone", () => {
    const memberWithoutRoles = buildWorkbenchView(model, {
      membershipType: "MEMBER",
      entitlements: [{ contractType: "ISO", plan: "STANDARD" }],
      roleCodes: [],
    });
    const admin = buildWorkbenchView(model, {
      membershipType: "ADMIN",
      entitlements: [{ contractType: "ISO", plan: "STANDARD" }],
      roleCodes: [],
    });

    expect(memberWithoutRoles.visibleMenus).toEqual([]);
    expect(memberWithoutRoles.visibleWidgets).toEqual([]);
    expect(admin.visibleMenus.map((item) => item.menuCode)).toEqual(["orders"]);
  });

  it("includes parent menus needed to render an effective child", () => {
    const nested = structuredClone(model);
    nested.menuRegistry.root = {
      menuCode: "root",
      title: "menu.root",
      parentMenuCode: null,
      path: "/",
      icon: null,
      order: 999,
    };
    nested.menuRegistry.orders.parentMenuCode = "root";

    const view = buildWorkbenchView(nested, {
      membershipType: "MEMBER",
      entitlements: [{ contractType: "ISO", plan: "STANDARD" }],
      roleCodes: ["preset_ops"],
    });

    expect(view.visibleMenus.map((item) => item.menuCode)).toEqual(["root", "orders"]);
    expect(view.visibleMenus.map((item) => [item.menuCode, item.depth])).toEqual([
      ["root", 0],
      ["orders", 1],
    ]);
    expect(view.permissions.find((item) => item.code === "orders.view")?.ownerLabel).toBe("订单");
  });
});
