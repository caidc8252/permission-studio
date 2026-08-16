import { describe, expect, it } from "vitest";

import { buildPermissionStudioModel } from "@/src/pep-webapp/build-model";
import { validModel } from "@/tests/fixtures/model";

describe("buildPermissionStudioModel", () => {
  it("sorts copied records and arrays into a deterministic strict model", () => {
    const input = {
      ...structuredClone(validModel),
      permissionCodes: ["orders.view", "orders.manage", "orders.view"],
      contractTypes: ["TEST", "ISO"],
      contractScope: {
        TEST: ["orders.view", "orders.manage"],
        ISO: ["orders.view", "orders.manage"],
      },
      roles: [
        {
          ...structuredClone(validModel.roles[0]),
          permissionCodes: ["orders.view"],
        },
      ],
    };
    const before = structuredClone(input);

    const model = buildPermissionStudioModel(input);

    expect(model.permissionCodes).toEqual(["orders.manage", "orders.view"]);
    expect(model.contractTypes).toEqual(["ISO", "TEST"]);
    expect(model.contractScope.ISO).toEqual(["orders.manage", "orders.view"]);
    expect(input).toEqual(before);
  });

  it("rejects target data with invalid catalog references", () => {
    expect(() =>
      buildPermissionStudioModel({
        ...structuredClone(validModel),
        contractMenus: { ISO: ["missing.menu"], TEST: ["orders"] },
      }),
    ).toThrow(/unknown menu/i);
  });
});
