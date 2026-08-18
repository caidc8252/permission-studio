import type { PermissionStudioModel } from "@/src/domain/model";

export interface NewRoleDraft {
  roleId: number;
  code: string;
  names: NewRoleNames;
  descriptions?: NewRoleDescriptions;
  permissionCodes: string[];
}

export interface NewRoleNames {
  en: string;
  "zh-CN": string;
  ja: string;
}

export type NewRoleDescriptions = NewRoleNames;

export type RoleDescriptionField = "descriptionEn" | "descriptionZhCn" | "descriptionJa";
export type RoleDescriptionValidationErrors = Partial<Record<RoleDescriptionField, string>>;

export interface NewRoleInput {
  roleId: number;
  code: string;
  names: NewRoleNames;
  descriptions?: NewRoleDescriptions;
  permissionCodes: readonly string[];
}

export type NewRoleField =
  | "roleId"
  | "code"
  | "nameEn"
  | "nameZhCn"
  | "nameJa"
  | "descriptionEn"
  | "descriptionZhCn"
  | "descriptionJa"
  | "permissionCodes";
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

function existingRoleNames(
  model: PermissionStudioModel,
  locale: keyof NewRoleNames,
  excludeModelCode?: string,
): Set<string> {
  const names = new Set<string>();
  for (const role of model.roles) {
    if (role.code === excludeModelCode) continue;
    const value = model.translations[locale][role.roleName];
    if (value) names.add(normalizedText(value));
  }
  return names;
}

export type RoleNameField = "nameEn" | "nameZhCn" | "nameJa";
export type RoleNameValidationErrors = Partial<Record<RoleNameField, string>>;

export function validateRoleNames(
  model: PermissionStudioModel,
  occupiedNames: readonly NewRoleNames[],
  names: NewRoleNames,
  excludeModelCode?: string,
): RoleNameValidationErrors {
  const errors: RoleNameValidationErrors = {};
  const locales = [
    { locale: "zh-CN", field: "nameZhCn", label: "中文名称" },
    { locale: "en", field: "nameEn", label: "英文名称" },
    { locale: "ja", field: "nameJa", label: "日文名称" },
  ] as const;
  for (const { locale, field, label } of locales) {
    const name = names[locale].trim();
    const normalizedName = normalizedText(name);
    if (!name || name.length > 100 || hasControlCharacter(name)) {
      errors[field] = `${label}不能为空，且不能超过 100 个字符`;
    } else if (
      existingRoleNames(model, locale, excludeModelCode).has(normalizedName) ||
      occupiedNames.some((candidate) => normalizedText(candidate[locale]) === normalizedName)
    ) {
      errors[field] = `${label}已存在`;
    }
  }
  return errors;
}

export function validateRoleDescriptions(
  descriptions: NewRoleDescriptions,
): RoleDescriptionValidationErrors {
  const errors: RoleDescriptionValidationErrors = {};
  const fields = [
    { locale: "zh-CN", field: "descriptionZhCn", label: "中文描述" },
    { locale: "en", field: "descriptionEn", label: "英文描述" },
    { locale: "ja", field: "descriptionJa", label: "日文描述" },
  ] as const;
  for (const { locale, field, label } of fields) {
    const description = descriptions[locale].trim();
    if (!description || description.length > 500 || hasControlCharacter(description)) {
      errors[field] = `${label}不能为空，且不能超过 500 个字符`;
    }
  }
  return errors;
}

export function roleI18nStem(roleCode: string): string {
  return roleCode.replace(/_(.)/gu, (_, character: string) => character.toUpperCase());
}

export function validateRoleCode(
  model: PermissionStudioModel,
  code: string,
  options: {
    excludeModelCode?: string;
    occupiedCodes?: readonly string[];
  } = {},
): string | undefined {
  const trimmed = code.trim();
  const normalizedCode = normalizedText(trimmed);
  if (!CODE_PATTERN.test(trimmed)) {
    return "角色编码必须以 preset_ 开头，且只能包含小写字母、数字和下划线";
  }
  const isOccupied = model.roles.some(
    (role) =>
      role.code !== options.excludeModelCode && normalizedText(role.code) === normalizedCode,
  );
  const isDraftOccupied = (options.occupiedCodes ?? []).some(
    (candidate) => normalizedText(candidate) === normalizedCode,
  );
  return isOccupied || isDraftOccupied ? "角色编码已存在" : undefined;
}

export function validateNewRole(
  model: PermissionStudioModel,
  otherNewRoles: readonly NewRoleDraft[],
  input: NewRoleInput,
): NewRoleValidationErrors {
  const errors: NewRoleValidationErrors = {};
  const code = input.code.trim();

  if (!Number.isInteger(input.roleId) || input.roleId < 1 || input.roleId >= 1000) {
    errors.roleId = "角色 ID 必须是 1–999 的整数";
  } else if (
    model.roles.some((role) => role.roleId === input.roleId) ||
    otherNewRoles.some((role) => role.roleId === input.roleId)
  ) {
    errors.roleId = "角色 ID 已存在";
  }

  const codeError = validateRoleCode(model, code, {
    occupiedCodes: otherNewRoles.map((role) => role.code),
  });
  if (codeError) errors.code = codeError;

  Object.assign(
    errors,
    validateRoleNames(
      model,
      otherNewRoles.map((role) => role.names),
      input.names,
    ),
  );

  if (input.descriptions) {
    Object.assign(errors, validateRoleDescriptions(input.descriptions));
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
    ...(input.descriptions
      ? {
          descriptions: {
            en: input.descriptions.en.trim(),
            "zh-CN": input.descriptions["zh-CN"].trim(),
            ja: input.descriptions.ja.trim(),
          },
        }
      : {}),
    permissionCodes: [...new Set(input.permissionCodes)].sort(),
  };
}
