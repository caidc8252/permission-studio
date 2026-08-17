import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applySourceEdits,
  planNewRoleEdit,
  planRoleTranslationEdit,
  planSourceEdits,
} from "@/src/pep-webapp/source-editor.mjs";

const fixtures = join(process.cwd(), "tests", "fixtures", "pep-webapp", "source-editor");

describe("permission source editor", () => {
  it("adds and removes role permissions while preserving comments and order", () => {
    const source = readFileSync(join(fixtures, "roles.ts"), "utf8");
    const plan = planSourceEdits(source, {
      owner: "GLOBAL_ROLES",
      key: "preset_ops",
      field: "permissionCodes",
      add: ["orders.export"],
      remove: ["orders.manage"],
    });

    const changed = applySourceEdits(source, plan);

    expect(changed).toContain("// preserved header");
    expect(changed).toContain("// preserved inline");
    expect(changed).toContain('"orders.view"');
    expect(changed).not.toContain('"orders.manage"');
    expect(changed).toContain('"orders.export"');
    expect(changed.indexOf('"orders.view"')).toBeLessThan(changed.indexOf('"orders.export"'));
    expect(
      applySourceEdits(
        changed,
        planSourceEdits(changed, {
          owner: "GLOBAL_ROLES",
          key: "preset_ops",
          field: "permissionCodes",
          add: ["orders.export"],
          remove: ["orders.manage"],
        }),
      ),
    ).toBe(changed);
  });

  it("preserves CRLF and edits inline arrays", () => {
    const source =
      'export const GLOBAL_ROLES = [{ code: "preset_ops", permissionCodes: ["a"] }];\r\n';
    const changed = applySourceEdits(
      source,
      planSourceEdits(source, {
        owner: "GLOBAL_ROLES",
        key: "preset_ops",
        field: "permissionCodes",
        add: ["b"],
        remove: [],
      }),
    );

    expect(changed).toContain('["a", "b"]');
    expect(changed).not.toMatch(/(?<!\r)\n/u);
  });

  it("adds a static role and matching role translations", () => {
    const roles = readFileSync(join(fixtures, "roles.ts"), "utf8");
    const changedRoles = applySourceEdits(
      roles,
      planNewRoleEdit(roles, {
        roleId: 99,
        code: "preset_auditor",
        names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
        permissionCodes: ["orders.view"],
      }),
    );
    const i18n = readFileSync(join(fixtures, "i18n", "zh-CN.ts"), "utf8");
    const changedI18n = applySourceEdits(
      i18n,
      planRoleTranslationEdit(i18n, "presetAuditor", "审计员"),
    );

    expect(changedRoles).toMatch(/"?roleId"?: 99/u);
    expect(changedRoles).toMatch(/"?code"?: "preset_auditor"/u);
    expect(changedRoles).toMatch(/"?roleName"?: "role\.presetAuditor"/u);
    expect(changedRoles).toContain('"orders.view"');
    expect(changedI18n).toContain('presetAuditor: "审计员"');
    expect(changedI18n).toContain('presetAuditorDesc: "审计员"');
  });

  it("rejects duplicate role ids and occupied translation keys", () => {
    expect(() =>
      planNewRoleEdit(
        'const GLOBAL_ROLES = [{ roleId: 99, code: "preset_old", permissionCodes: [] }];',
        {
          roleId: 99,
          code: "preset_auditor",
          permissionCodes: [],
        },
      ),
    ).toThrow(/duplicate role ID/i);
    expect(() =>
      planRoleTranslationEdit(
        'const messages = { role: { presetAuditor: "Auditor" } };',
        "presetAuditor",
        "审计员",
      ),
    ).toThrow(/already exists/i);
  });

  it("expands only an inherited widget spread when removing a common widget", () => {
    const source = readFileSync(join(fixtures, "contract-types.ts"), "utf8");
    const changed = applySourceEdits(
      source,
      planSourceEdits(source, {
        owner: "CONTRACT_WIDGETS",
        key: "ISO",
        add: [],
        remove: ["widget.welcome"],
      }),
    );

    const widgetsStart = changed.indexOf("CONTRACT_WIDGETS");
    const isoStart = changed.indexOf("ISO:", widgetsStart);
    const iso = changed.slice(isoStart, changed.indexOf("TEST:", isoStart));
    expect(iso).not.toContain("...COMMON_WIDGETS");
    expect(iso).toContain('"widget.alerts"');
    expect(iso).toContain("// preserved widget note");
    expect(changed.slice(changed.indexOf("TEST:", changed.indexOf("CONTRACT_WIDGETS")))).toContain(
      'TEST: [...COMMON_WIDGETS, "widget.quick"]',
    );
  });

  it("fails closed for unknown, computed, and dynamic shapes", () => {
    expect(() =>
      planSourceEdits("const OTHER = {};", {
        owner: "GLOBAL_ROLES",
        key: "preset_ops",
        field: "permissionCodes",
        add: ["a"],
        remove: [],
      }),
    ).toThrow(/GLOBAL_ROLES/);
    expect(() =>
      planSourceEdits('const GLOBAL_ROLES = [{ code: key, permissionCodes: ["a"] }];', {
        owner: "GLOBAL_ROLES",
        key: "preset_ops",
        field: "permissionCodes",
        add: ["b"],
        remove: [],
      }),
    ).toThrow(/static/i);
    expect(() =>
      planSourceEdits('const CONTRACT_MENUS = { [contract]: ["orders"] };', {
        owner: "CONTRACT_MENUS",
        key: "ISO",
        add: ["tickets"],
        remove: [],
      }),
    ).toThrow(/computed/i);
    expect(() =>
      planSourceEdits(
        'const GLOBAL_ROLES = [{ code: "preset_ops", permissionCodes: makeCodes() }];',
        {
          owner: "GLOBAL_ROLES",
          key: "preset_ops",
          field: "permissionCodes",
          add: ["b"],
          remove: [],
        },
      ),
    ).toThrow(/array/i);
  });

  it("fails closed for duplicate owners, keys, and role codes", () => {
    const request = {
      owner: "GLOBAL_ROLES",
      key: "preset_ops",
      field: "permissionCodes",
      add: ["b"],
      remove: [],
    };
    expect(() =>
      planSourceEdits(
        'var GLOBAL_ROLES = []; var GLOBAL_ROLES = [{ code: "preset_ops", permissionCodes: ["a"] }];',
        request,
      ),
    ).toThrow(/duplicate.*GLOBAL_ROLES/i);
    expect(() =>
      planSourceEdits(
        'const GLOBAL_ROLES = [{ code: "preset_ops", code: "other", permissionCodes: ["a"] }];',
        request,
      ),
    ).toThrow(/duplicate.*code/i);
    expect(() =>
      planSourceEdits(
        'const GLOBAL_ROLES = [{ code: "preset_ops", permissionCodes: ["a"] }, { code: "preset_ops", permissionCodes: ["b"] }];',
        request,
      ),
    ).toThrow(/duplicate.*role/i);
  });

  it("rejects overlapping manual edits", () => {
    expect(() =>
      applySourceEdits("abcdef", [
        { start: 1, end: 4, text: "x" },
        { start: 3, end: 5, text: "y" },
      ]),
    ).toThrow(/overlap/i);
  });
});
