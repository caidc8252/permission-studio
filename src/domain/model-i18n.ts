import type { PermissionStudioModel } from "@/src/domain/model";

export const permissionStudioLocales = ["zh-CN", "en", "ja"] as const;

export type PermissionStudioLocale = (typeof permissionStudioLocales)[number];

export const defaultPermissionStudioLocale: PermissionStudioLocale = "zh-CN";

export function translatedModelText(
  model: PermissionStudioModel,
  locale: PermissionStudioLocale,
  key: string,
  fallback: string,
): string {
  return (
    model.translations[locale][key] ??
    (locale === defaultPermissionStudioLocale
      ? undefined
      : model.translations[defaultPermissionStudioLocale][key]) ??
    fallback
  );
}
