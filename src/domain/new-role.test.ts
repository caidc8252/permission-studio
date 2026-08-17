import { describe, expect, it } from "vitest";

import type { PermissionStudioModel } from "@/src/domain/model";
import {
  normalizeNewRole,
  roleI18nStem,
  validateNewRole,
  validateRoleCode,
} from "@/src/domain/new-role";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;
const input = {
  roleId: 99,
  code: "preset_auditor",
  names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
  descriptions: {
    en: "Reviews audit records",
    "zh-CN": "查看审计记录",
    ja: "監査記録を確認します",
  },
  permissionCodes: ["orders.view"],
};

describe("new role validation", () => {
  it("normalizes a unique role and derives its i18n stem", () => {
    expect(
      normalizeNewRole(model, [], {
        ...input,
        names: { en: " Auditor ", "zh-CN": " 审计员 ", ja: " 監査担当者 " },
        descriptions: {
          en: " Reviews audit records ",
          "zh-CN": " 查看审计记录 ",
          ja: " 監査記録を確認します ",
        },
      }),
    ).toEqual(input);
    expect(roleI18nStem(input.code)).toBe("presetAuditor");
  });

  it("requires three localized descriptions when descriptions are supplied", () => {
    expect(
      validateNewRole(model, [], {
        ...input,
        descriptions: { ...input.descriptions, en: "" },
      }).descriptionEn,
    ).toMatch(/英文描述/);
  });

  it("requires a preset code and an integer id below 1000", () => {
    expect(validateNewRole(model, [], { ...input, code: "custom_auditor" }).code).toMatch(
      /preset_/,
    );
    expect(validateNewRole(model, [], { ...input, roleId: 1000 }).roleId).toMatch(/1–999/);
    expect(validateNewRole(model, [], { ...input, roleId: 1.5 }).roleId).toMatch(/整数/);
  });

  it("validates an existing role code while excluding the role being edited", () => {
    expect(
      validateRoleCode(model, "preset_ops", { excludeModelCode: "preset_ops" }),
    ).toBeUndefined();
    expect(
      validateRoleCode(model, "preset_auditor", {
        excludeModelCode: "preset_ops",
        occupiedCodes: ["preset_auditor"],
      }),
    ).toBe("角色编码已存在");
  });

  it("rejects duplicate code, id, and locale-specific translated names", () => {
    const existing = model.roles[0]!;
    expect(validateNewRole(model, [], { ...input, code: existing.code }).code).toMatch(/已存在/);
    expect(validateNewRole(model, [], { ...input, roleId: existing.roleId }).roleId).toMatch(
      /已存在/,
    );
    for (const [locale, field] of [
      ["en", "nameEn"],
      ["zh-CN", "nameZhCn"],
      ["ja", "nameJa"],
    ] as const) {
      const names = { ...input.names, [locale]: model.translations[locale][existing.roleName]! };
      expect(validateNewRole(model, [], { ...input, names })[field]).toMatch(/已存在/);
    }
    expect(validateNewRole(model, [input], { ...input, roleId: 98 }).code).toMatch(/已存在/);
  });
});
