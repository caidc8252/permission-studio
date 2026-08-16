import { describe, expect, it } from "vitest";

import { buildExportModel, flattenTranslations } from "@/src/pep-webapp/export-model.mjs";
import { validModel } from "@/tests/fixtures/model";

const registry = {
  menuRegistry: validModel.menuRegistry,
  permissionRegistry: validModel.permissionRegistry,
  permissionAvailability: validModel.permissionAvailability,
  diagnostics: [],
};

const collected = {
  modules: [],
  menuTree: [],
  contractTypes: validModel.contractTypes,
  contractMenus: validModel.contractMenus,
  contractWidgets: validModel.contractWidgets,
  contractPlanPolicies: validModel.contractPlanPolicies,
  permissionAvailabilityBypassContracts: validModel.permissionAvailabilityBypassContracts,
  globalRoles: validModel.roles,
};

const coc = {
  buildRegistry: () => registry,
  validateCatalog: () => [],
  validatePermissionAvailability: () => [],
  deriveContractScope: () => validModel.contractScope,
  validateContractPlanPolicies: () => [],
  validateGlobalRoles: () => [],
  validatePresetAdminCoverage: () => [],
};

describe("target model exporter", () => {
  it("flattens generated locale objects", () => {
    expect(
      flattenTranslations({
        menu: { orders: "Orders" },
        permission: { orders: { view: "View orders" } },
      }),
    ).toEqual({
      "menu.orders": "Orders",
      "permission.orders.view": "View orders",
    });
  });

  it("builds the strict model using target CoC primitives", () => {
    const model = buildExportModel({
      sourceSha: validModel.sourceSha,
      collected,
      coc,
      presetRoleIdMax: 1_000,
      translations: validModel.translations,
    });

    expect(model).toEqual(validModel);
  });

  it("fails closed on target diagnostics before producing a model", () => {
    expect(() =>
      buildExportModel({
        sourceSha: validModel.sourceSha,
        collected,
        coc: {
          ...coc,
          validateCatalog: () => [
            {
              level: "error",
              rule: "catalog-reference-missing",
              message: "missing menu",
            },
          ],
        },
        presetRoleIdMax: 1_000,
        translations: validModel.translations,
      }),
    ).toThrow(/catalog-reference-missing.*missing menu/i);
  });
});
