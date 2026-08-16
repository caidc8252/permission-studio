import { readFile } from "node:fs/promises";
import process from "node:process";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildPermissionStudioModel } from "./build-model.ts";

const LOCALES = ["en", "zh-CN", "ja"];

export function flattenTranslations(input) {
  const output = {};
  const visit = (value, prefix) => {
    if (typeof value === "string") {
      if (!prefix) throw new Error("Translation root cannot be a string");
      output[prefix] = value;
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Translation "${prefix || "<root>"}" must be an object or string`);
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  visit(input, "");
  return output;
}

export function buildExportModel({ sourceSha, collected, coc, presetRoleIdMax, translations }) {
  const result = coc.buildRegistry({
    modules: collected.modules,
    menuTree: collected.menuTree,
  });
  const contractScopeOptions = {
    availabilityBypassContracts: collected.permissionAvailabilityBypassContracts ?? [],
    contractWidgets: collected.contractWidgets ?? {},
  };
  const contractScope = coc.deriveContractScope(
    collected.contractMenus,
    result,
    contractScopeOptions,
  );
  const diagnostics = [
    ...(result.diagnostics ?? []),
    ...coc.validateCatalog({
      result,
      roleCodes: [...new Set(collected.globalRoles.flatMap((role) => role.permissionCodes))],
      contractMenus: [...new Set(Object.values(collected.contractMenus).flat())],
      contractWidgets: [...new Set(Object.values(collected.contractWidgets ?? {}).flat())],
    }),
    ...coc.validatePermissionAvailability({
      result,
      contractMenus: collected.contractMenus,
      ...contractScopeOptions,
    }),
    ...coc.validateContractPlanPolicies({
      result,
      contractTypes: collected.contractTypes,
      contractScope,
      policies: collected.contractPlanPolicies ?? {},
    }),
    ...coc.validateGlobalRoles({
      globalRoles: collected.globalRoles,
      minId: 1,
      maxId: presetRoleIdMax,
    }),
    ...coc.validatePresetAdminCoverage({
      globalRoles: collected.globalRoles,
      allPermissionCodes: Object.keys(result.permissionRegistry),
    }),
  ];
  const errors = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  if (errors.length) {
    throw new Error(
      errors
        .map(
          (diagnostic) =>
            `[${diagnostic.rule ?? "unknown"}] ${diagnostic.message ?? "unknown diagnostic"}`,
        )
        .join("\n"),
    );
  }

  return buildPermissionStudioModel({
    schemaVersion: 1,
    sourceSha,
    permissionCodes: Object.keys(result.permissionRegistry),
    menuRegistry: result.menuRegistry,
    permissionRegistry: result.permissionRegistry,
    permissionAvailability: result.permissionAvailability,
    permissionAvailabilityBypassContracts: collected.permissionAvailabilityBypassContracts ?? [],
    contractScope,
    contractTypes: collected.contractTypes,
    contractMenus: collected.contractMenus,
    contractWidgets: collected.contractWidgets ?? {},
    contractPlanPolicies: collected.contractPlanPolicies ?? {},
    roles: collected.globalRoles,
    translations,
  });
}

async function loadGeneratedTranslations(targetRoot) {
  const translations = {};
  for (const locale of LOCALES) {
    const file = join(
      targetRoot,
      "apps",
      "web",
      "manifest",
      "_generated",
      "i18n",
      `${locale}.json`,
    );
    translations[locale] = flattenTranslations(JSON.parse(await readFile(file, "utf8")));
  }
  return translations;
}

export async function exportTargetModel(targetRoot, sourceSha) {
  const collectedUrl = pathToFileURL(
    join(targetRoot, "apps", "web", "manifest", "collect.ts"),
  ).href;
  const cocUrl = pathToFileURL(
    join(targetRoot, "packages", "platform-config", "src", "coc", "index.ts"),
  ).href;
  const roleIdUrl = pathToFileURL(
    join(targetRoot, "packages", "platform-config", "src", "role-id.ts"),
  ).href;
  const [{ collected }, coc, { PRESET_ROLE_ID_MAX }] = await Promise.all([
    import(collectedUrl),
    import(cocUrl),
    import(roleIdUrl),
  ]);
  return buildExportModel({
    sourceSha,
    collected,
    coc,
    presetRoleIdMax: PRESET_ROLE_ID_MAX,
    translations: await loadGeneratedTranslations(targetRoot),
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const targetRoot = process.argv[2] ? resolve(process.argv[2]) : "";
  const sourceSha = process.argv[3] ?? "";
  if (!targetRoot || !/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error("Usage: node export-model.mjs <target-root> <40-char-source-sha>");
  }
  const model = await exportTargetModel(targetRoot, sourceSha);
  process.stdout.write(`${JSON.stringify(model)}\n`);
}
