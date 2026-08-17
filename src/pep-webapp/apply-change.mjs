import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import process from "node:process";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applySourceEdits,
  planNewRoleEdit,
  planRoleCodeEdit,
  planRoleDeletionEdit,
  planRoleTranslationEdit,
  planRoleTranslationNameEdit,
  planRoleTranslationDeletionEdit,
  planSourceEdits,
} from "./source-editor.mjs";

export const ALLOWED_CATALOG_PATHS = Object.freeze([
  "apps/web/manifest/catalog/roles.ts",
  "apps/web/manifest/catalog/contract-types.ts",
  "apps/web/manifest/catalog/i18n/en.ts",
  "apps/web/manifest/catalog/i18n/zh-CN.ts",
  "apps/web/manifest/catalog/i18n/ja.ts",
]);

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".sql",
]);
const SKIPPED_DIRECTORIES = new Set([".git", ".next", "coverage", "dist", "node_modules"]);

function containsToken(source, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_.-])${escaped}(?=$|[^A-Za-z0-9_.-])`, "mu").test(
    source,
  );
}

async function findRoleReferences(root, roleCodes) {
  const tokens = new Map(
    roleCodes.map((roleCode) => {
      const stem = roleCode.replace(/_(.)/gu, (_, character) => character.toUpperCase());
      return [roleCode, [roleCode, `role.${stem}`, `role.${stem}Desc`]];
    }),
  );
  const references = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
          await visit(join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !SCANNED_EXTENSIONS.has(extname(entry.name))) continue;
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).replaceAll("\\", "/");
      if (ALLOWED_CATALOG_PATHS.includes(relativePath)) continue;
      const source = await readFile(path, "utf8");
      for (const [roleCode, roleTokens] of tokens) {
        if (roleTokens.some((token) => containsToken(source, token))) {
          references.push({ roleCode, relativePath });
        }
      }
    }
  };
  await visit(root);
  return references;
}

async function atomicWrite(files) {
  const staged = [];
  const replaced = [];
  try {
    for (const file of files) {
      const temporaryPath = join(
        dirname(file.path),
        `.${file.path.split(/[\\/]/u).at(-1)}.${process.pid}.tmp`,
      );
      await writeFile(temporaryPath, file.content, "utf8");
      staged.push({ ...file, temporaryPath });
    }
    for (const file of staged) {
      await rename(file.temporaryPath, file.path);
      replaced.push(file);
    }
  } catch (error) {
    await Promise.allSettled(replaced.map((file) => writeFile(file.path, file.original, "utf8")));
    throw error;
  } finally {
    await Promise.allSettled(staged.map((file) => unlink(file.temporaryPath)));
  }
}

function applyRequest(source, request) {
  return applySourceEdits(source, planSourceEdits(source, request));
}

export async function applyPermissionChange(worktreePath, change) {
  const root = resolve(worktreePath);
  const deletedRoleCodes = [...new Set(change.deletedRoleCodes ?? [])].sort();
  if (deletedRoleCodes.length) {
    const references = await findRoleReferences(root, deletedRoleCodes);
    if (references.length) {
      const summary = references
        .slice(0, 8)
        .map(({ roleCode, relativePath }) => `${roleCode}: ${relativePath}`)
        .join(", ");
      throw new Error(`Role deletion is blocked by external references: ${summary}`);
    }
  }
  const rolesPath = join(root, ...ALLOWED_CATALOG_PATHS[0].split("/"));
  const contractsPath = join(root, ...ALLOWED_CATALOG_PATHS[1].split("/"));
  const translationPaths = ALLOWED_CATALOG_PATHS.slice(2).map((path) =>
    join(root, ...path.split("/")),
  );
  const [originalRoles, originalContracts, ...originalTranslations] = await Promise.all([
    readFile(rolesPath, "utf8"),
    readFile(contractsPath, "utf8"),
    ...translationPaths.map((path) => readFile(path, "utf8")),
  ]);
  let roles = originalRoles;
  let contracts = originalContracts;
  const translations = [...originalTranslations];
  const locales = ["en", "zh-CN", "ja"];

  for (const role of change.newRoles ?? []) {
    roles = applySourceEdits(roles, planNewRoleEdit(roles, role));
    const stem = role.code.replace(/_(.)/gu, (_, character) => character.toUpperCase());
    for (const [index, source] of translations.entries()) {
      translations[index] = applySourceEdits(
        source,
        planRoleTranslationEdit(
          source,
          stem,
          role.names[locales[index]],
          role.descriptions?.[locales[index]] ?? role.names[locales[index]],
        ),
      );
    }
  }

  for (const roleCode of deletedRoleCodes) {
    roles = applySourceEdits(roles, planRoleDeletionEdit(roles, roleCode));
    const stem = roleCode.replace(/_(.)/gu, (_, character) => character.toUpperCase());
    for (const [index, source] of translations.entries()) {
      translations[index] = applySourceEdits(source, planRoleTranslationDeletionEdit(source, stem));
    }
  }

  for (const role of change.roleChanges ?? []) {
    roles = applyRequest(roles, {
      owner: "GLOBAL_ROLES",
      key: role.roleCode,
      fallbackKey: role.newRoleCode,
      field: "permissionCodes",
      add: role.add,
      remove: role.remove,
    });
    if (role.newRoleCode) {
      roles = applySourceEdits(roles, planRoleCodeEdit(roles, role.roleCode, role.newRoleCode));
    }
    if (role.names) {
      const stem = role.roleNameKey.slice("role.".length);
      for (const [index, source] of translations.entries()) {
        translations[index] = applySourceEdits(
          source,
          planRoleTranslationNameEdit(source, stem, role.names[locales[index]]),
        );
      }
    }
  }
  for (const contract of change.contractChanges ?? []) {
    if (contract.menus.add.length || contract.menus.remove.length) {
      contracts = applyRequest(contracts, {
        owner: "CONTRACT_MENUS",
        key: contract.contractType,
        add: contract.menus.add,
        remove: contract.menus.remove,
      });
    }
    if (contract.widgets.add.length || contract.widgets.remove.length) {
      contracts = applyRequest(contracts, {
        owner: "CONTRACT_WIDGETS",
        key: contract.contractType,
        add: contract.widgets.add,
        remove: contract.widgets.remove,
      });
    }
  }

  const files = [
    {
      path: rolesPath,
      original: originalRoles,
      content: roles,
      relativePath: ALLOWED_CATALOG_PATHS[0],
    },
    {
      path: contractsPath,
      original: originalContracts,
      content: contracts,
      relativePath: ALLOWED_CATALOG_PATHS[1],
    },
    ...translations.map((content, index) => ({
      path: translationPaths[index],
      original: originalTranslations[index],
      content,
      relativePath: ALLOWED_CATALOG_PATHS[index + 2],
    })),
  ].filter((file) => file.original !== file.content);
  if (files.length) await atomicWrite(files);
  return { touchedFiles: files.map(({ relativePath }) => relativePath) };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const worktreePath = process.argv[2] ? resolve(process.argv[2]) : "";
  const changePath = process.argv[3] ? resolve(process.argv[3]) : "";
  if (!worktreePath || !changePath) {
    throw new Error("Usage: node apply-change.mjs <worktree-path> <change-json-path>");
  }
  const change = JSON.parse(await readFile(changePath, "utf8"));
  process.stdout.write(`${JSON.stringify(await applyPermissionChange(worktreePath, change))}\n`);
}
