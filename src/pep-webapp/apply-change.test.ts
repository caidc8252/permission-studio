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
  });
});
