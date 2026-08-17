import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyPermissionChange } from "@/src/pep-webapp/apply-change.mjs";

const roots: string[] = [];
const fixtureRoot = join(process.cwd(), "tests", "fixtures", "pep-webapp", "source-editor");

function targetFixture() {
  const root = mkdtempSync(join(tmpdir(), "permission-studio-editor-"));
  roots.push(root);
  const catalog = join(root, "apps", "web", "manifest", "catalog");
  cpSync(fixtureRoot, catalog, { recursive: true });
  return { root, catalog };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("applyPermissionChange", () => {
  it("plans all files before writing and remains atomic on unsupported input", async () => {
    const { root, catalog } = targetFixture();
    const rolesPath = join(catalog, "roles.ts");
    const contractsPath = join(catalog, "contract-types.ts");
    const originalRoles = readFileSync(rolesPath, "utf8");
    writeFileSync(contractsPath, "export const CONTRACT_MENUS = makeMenus();\n", "utf8");

    await expect(
      applyPermissionChange(root, {
        roleChanges: [{ roleCode: "preset_ops", add: ["orders.export"], remove: [] }],
        contractChanges: [
          {
            contractType: "ISO",
            menus: { add: ["tickets"], remove: [] },
            widgets: { add: [], remove: [] },
          },
        ],
      }),
    ).rejects.toThrow(/object/i);
    expect(readFileSync(rolesPath, "utf8")).toBe(originalRoles);
  });

  it("applies role, menu, and widget changes atomically and idempotently", async () => {
    const { root, catalog } = targetFixture();
    const change = {
      roleChanges: [{ roleCode: "preset_ops", add: ["orders.export"], remove: ["orders.manage"] }],
      contractChanges: [
        {
          contractType: "ISO",
          menus: { add: ["reports"], remove: ["tickets"] },
          widgets: { add: ["widget.extra"], remove: ["widget.welcome"] },
        },
      ],
    };

    const first = await applyPermissionChange(root, change);
    const snapshot = [
      readFileSync(join(catalog, "roles.ts"), "utf8"),
      readFileSync(join(catalog, "contract-types.ts"), "utf8"),
    ];
    const second = await applyPermissionChange(root, change);

    expect(first.touchedFiles).toEqual([
      "apps/web/manifest/catalog/roles.ts",
      "apps/web/manifest/catalog/contract-types.ts",
    ]);
    expect(second.touchedFiles).toEqual([]);
    expect(readFileSync(join(catalog, "roles.ts"), "utf8")).toBe(snapshot[0]);
    expect(readFileSync(join(catalog, "contract-types.ts"), "utf8")).toBe(snapshot[1]);
  });

  it("adds a role and all locale entries atomically and idempotently", async () => {
    const { root, catalog } = targetFixture();
    const change = {
      newRoles: [
        {
          roleId: 99,
          code: "preset_auditor",
          names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
          descriptions: {
            en: "Reviews audit records",
            "zh-CN": "查看审计记录",
            ja: "監査記録を確認します",
          },
          permissionCodes: ["orders.view"],
        },
      ],
      roleChanges: [],
      contractChanges: [],
    };

    const first = await applyPermissionChange(root, change);
    const second = await applyPermissionChange(root, change);

    expect(first.touchedFiles).toEqual([
      "apps/web/manifest/catalog/roles.ts",
      "apps/web/manifest/catalog/i18n/en.ts",
      "apps/web/manifest/catalog/i18n/zh-CN.ts",
      "apps/web/manifest/catalog/i18n/ja.ts",
    ]);
    expect(second.touchedFiles).toEqual([]);
    expect(readFileSync(join(catalog, "roles.ts"), "utf8")).toMatch(/"?code"?: "preset_auditor"/u);
    for (const [locale, name] of [
      ["en", "Auditor"],
      ["zh-CN", "审计员"],
      ["ja", "監査担当者"],
    ]) {
      expect(readFileSync(join(catalog, "i18n", `${locale}.ts`), "utf8")).toContain(
        `presetAuditor: "${name}"`,
      );
    }
    expect(readFileSync(join(catalog, "i18n", "zh-CN.ts"), "utf8")).toContain(
      'presetAuditorDesc: "查看审计记录"',
    );
  });

  it("updates permissions before renaming an existing role code", async () => {
    const { root, catalog } = targetFixture();
    const change = {
      newRoles: [],
      roleChanges: [
        {
          roleCode: "preset_ops",
          newRoleCode: "preset_operations",
          add: ["orders.export"],
          remove: ["orders.manage"],
        },
      ],
      contractChanges: [],
    };

    const first = await applyPermissionChange(root, change);
    const second = await applyPermissionChange(root, change);
    const roles = readFileSync(join(catalog, "roles.ts"), "utf8");

    expect(first.touchedFiles).toEqual(["apps/web/manifest/catalog/roles.ts"]);
    expect(second.touchedFiles).toEqual([]);
    expect(roles).toContain('code: "preset_operations"');
    expect(roles).toContain('"orders.export"');
    expect(roles).not.toContain('"orders.manage"');
  });

  it("updates all existing-role locale names atomically and idempotently", async () => {
    const { root, catalog } = targetFixture();
    const change = {
      newRoles: [],
      roleChanges: [
        {
          roleCode: "preset_ops",
          roleNameKey: "role.presetOps",
          names: { en: "Operations Admin", "zh-CN": "运营管理员", ja: "運用管理者" },
          add: [],
          remove: [],
        },
      ],
      contractChanges: [],
    };

    const first = await applyPermissionChange(root, change);
    const second = await applyPermissionChange(root, change);

    expect(first.touchedFiles).toEqual([
      "apps/web/manifest/catalog/i18n/en.ts",
      "apps/web/manifest/catalog/i18n/zh-CN.ts",
      "apps/web/manifest/catalog/i18n/ja.ts",
    ]);
    expect(second.touchedFiles).toEqual([]);
    for (const [locale, name] of [
      ["en", "Operations Admin"],
      ["zh-CN", "运营管理员"],
      ["ja", "運用管理者"],
    ]) {
      expect(readFileSync(join(catalog, "i18n", `${locale}.ts`), "utf8")).toContain(
        `presetOps: "${name}"`,
      );
    }
  });

  it("deletes a role and all locale entries atomically and idempotently", async () => {
    const { root, catalog } = targetFixture();
    const change = {
      deletedRoleCodes: ["preset_ops"],
      newRoles: [],
      roleChanges: [],
      contractChanges: [],
    };

    const first = await applyPermissionChange(root, change);
    const second = await applyPermissionChange(root, change);

    expect(first.touchedFiles).toEqual([
      "apps/web/manifest/catalog/roles.ts",
      "apps/web/manifest/catalog/i18n/en.ts",
      "apps/web/manifest/catalog/i18n/zh-CN.ts",
      "apps/web/manifest/catalog/i18n/ja.ts",
    ]);
    expect(second.touchedFiles).toEqual([]);
    expect(readFileSync(join(catalog, "roles.ts"), "utf8")).not.toContain('code: "preset_ops"');
    for (const locale of ["en", "zh-CN", "ja"]) {
      const translation = readFileSync(join(catalog, "i18n", `${locale}.ts`), "utf8");
      expect(translation).not.toContain("presetOps:");
      expect(translation).not.toContain("presetOpsDesc:");
    }
  });

  it("blocks deletion when the role still has external source references", async () => {
    const { root } = targetFixture();
    const referencePath = join(root, "apps", "web", "runtime.ts");
    writeFileSync(referencePath, 'export const defaultRole = "preset_ops";\n', "utf8");

    await expect(
      applyPermissionChange(root, {
        deletedRoleCodes: ["preset_ops"],
        newRoles: [],
        roleChanges: [],
        contractChanges: [],
      }),
    ).rejects.toThrow(/runtime\.ts/u);
  });

  it("blocks deletion for an unquoted role reference in configuration", async () => {
    const { root } = targetFixture();
    const referencePath = join(root, "apps", "web", "role-defaults.yaml");
    writeFileSync(referencePath, "defaultRole: preset_ops\n", "utf8");

    await expect(
      applyPermissionChange(root, {
        deletedRoleCodes: ["preset_ops"],
        newRoles: [],
        roleChanges: [],
        contractChanges: [],
      }),
    ).rejects.toThrow(/role-defaults\.yaml/u);
  });
});
