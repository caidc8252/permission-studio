import type { PermissionStudioModel } from "@/src/domain/model";

export interface NewRoleDraft {
  roleId: number;
  code: string;
  names: NewRoleNames;
  permissionCodes: string[];
}

export interface NewRoleNames {
  en: string;
  "zh-CN": string;
  ja: string;
}

export interface NewRoleInput {
  roleId: number;
  code: string;
  names: NewRoleNames;
  permissionCodes: readonly string[];
}

export type NewRoleField = "roleId" | "code" | "nameEn" | "nameZhCn" | "nameJa" | "permissionCodes";
export type NewRoleValidationErrors = Partial<Record<NewRoleField, string>>;

const CODE_PATTERN = /^preset_[a-z0-9_]+$/;

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function existingRoleNames(model: PermissionStudioModel, locale: keyof NewRoleNames): Set<string> {
  const names = new Set<string>();
  for (const role of model.roles) {
    const value = model.translations[locale][role.roleName];
    if (value) names.add(normalizedText(value));
  }
  return names;
}

export function roleI18nStem(roleCode: string): string {
  return roleCode.replace(/_(.)/gu, (_, character: string) => character.toUpperCase());
}

export function validateNewRole(
  model: PermissionStudioModel,
  otherNewRoles: readonly NewRoleDraft[],
  input: NewRoleInput,
): NewRoleValidationErrors {
  const errors: NewRoleValidationErrors = {};
  const code = input.code.trim();
  const normalizedCode = normalizedText(code);

  if (!Number.isInteger(input.roleId) || input.roleId < 1 || input.roleId >= 1000) {
    errors.roleId = "角色 ID 必须是 1–999 的整数";
  } else if (
    model.roles.some((role) => role.roleId === input.roleId) ||
    otherNewRoles.some((role) => role.roleId === input.roleId)
  ) {
    errors.roleId = "角色 ID 已存在";
  }

  if (!CODE_PATTERN.test(code)) {
    errors.code = "角色编码必须以 preset_ 开头，且只能包含小写字母、数字和下划线";
  } else if (
    model.roles.some((role) => normalizedText(role.code) === normalizedCode) ||
    otherNewRoles.some((role) => normalizedText(role.code) === normalizedCode)
  ) {
    errors.code = "角色编码已存在";
  }

  const locales = [
    { locale: "zh-CN", field: "nameZhCn", label: "中文名称" },
    { locale: "en", field: "nameEn", label: "英文名称" },
    { locale: "ja", field: "nameJa", label: "日文名称" },
  ] as const;
  for (const { locale, field, label } of locales) {
    const name = input.names[locale].trim();
    const normalizedName = normalizedText(name);
    if (!name || name.length > 100 || hasControlCharacter(name)) {
      errors[field] = `${label}不能为空，且不能超过 100 个字符`;
    } else if (
      existingRoleNames(model, locale).has(normalizedName) ||
      otherNewRoles.some((role) => normalizedText(role.names[locale]) === normalizedName)
    ) {
      errors[field] = `${label}已存在`;
    }
  }

  const permissions = new Set(model.permissionCodes);
  if (input.permissionCodes.some((code) => !permissions.has(code))) {
    errors.permissionCodes = "包含未知权限";
  }

  return errors;
}

export function normalizeNewRole(
  model: PermissionStudioModel,
  otherNewRoles: readonly NewRoleDraft[],
  input: NewRoleInput,
): NewRoleDraft {
  const errors = validateNewRole(model, otherNewRoles, input);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);
  return {
    roleId: input.roleId,
    code: input.code.trim(),
    names: {
      en: input.names.en.trim(),
      "zh-CN": input.names["zh-CN"].trim(),
      ja: input.names.ja.trim(),
    },
    permissionCodes: [...new Set(input.permissionCodes)].sort(),
  };
}
