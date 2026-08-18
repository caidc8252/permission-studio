"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import styles from "@/src/components/studio/new-role-form.module.css";
import { updateExistingRole, type PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import {
  validateRoleCode,
  validateRoleDescriptions,
  validateRoleNames,
  type NewRoleDescriptions,
  type NewRoleNames,
  type RoleDescriptionField,
  type RoleNameField,
} from "@/src/domain/new-role";

interface EditRoleCodeFormProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  roleCode: string;
  roleLabel: string;
  onDraftChange: (draft: PermissionDraft) => void;
  onCancel: () => void;
  onSaved: (roleCode: string) => void;
}

const nameFields = [
  { locale: "zh-CN", field: "nameZhCn", label: "中文名称" },
  { locale: "en", field: "nameEn", label: "英文名称" },
  { locale: "ja", field: "nameJa", label: "日文名称" },
] as const satisfies ReadonlyArray<{
  locale: keyof NewRoleNames;
  field: RoleNameField;
  label: string;
}>;

const descriptionFields = [
  { locale: "zh-CN", field: "descriptionZhCn", label: "中文描述" },
  { locale: "en", field: "descriptionEn", label: "英文描述" },
  { locale: "ja", field: "descriptionJa", label: "日文描述" },
] as const satisfies ReadonlyArray<{
  locale: keyof NewRoleDescriptions;
  field: RoleDescriptionField;
  label: string;
}>;

type TranslationTarget = "name" | "description";

export function EditRoleCodeForm({
  model,
  draft,
  roleCode,
  roleLabel,
  onDraftChange,
  onCancel,
  onSaved,
}: EditRoleCodeFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const role = model.roles.find((candidate) => candidate.code === roleCode)!;
  const [code, setCode] = useState(draft.roleRenames?.[roleCode] ?? roleCode);
  const [names, setNames] = useState<NewRoleNames>(
    draft.roleNames?.[roleCode] ?? {
      en: model.translations.en[role.roleName] ?? roleCode,
      "zh-CN": model.translations["zh-CN"][role.roleName] ?? roleCode,
      ja: model.translations.ja[role.roleName] ?? roleCode,
    },
  );
  const [descriptions, setDescriptions] = useState<NewRoleDescriptions>(
    draft.roleDescriptions?.[roleCode] ?? {
      en: model.translations.en[role.remark] ?? roleCode,
      "zh-CN": model.translations["zh-CN"][role.remark] ?? roleCode,
      ja: model.translations.ja[role.remark] ?? roleCode,
    },
  );
  const [attempted, setAttempted] = useState(false);
  const [translating, setTranslating] = useState<TranslationTarget | null>(null);
  const [translationFeedback, setTranslationFeedback] = useState<
    Partial<Record<TranslationTarget, { kind: "success" | "error"; message: string }>>
  >({});
  const occupiedCodes = [
    ...draft.newRoles.map((role) => role.code),
    ...Object.entries(draft.roleRenames ?? {})
      .filter(([sourceCode]) => sourceCode !== roleCode)
      .map(([, renamedCode]) => renamedCode),
  ];
  const codeError = validateRoleCode(model, code, {
    excludeModelCode: roleCode,
    occupiedCodes,
  });
  const occupiedNames = [
    ...draft.newRoles.map((candidate) => candidate.names),
    ...Object.entries(draft.roleNames ?? {})
      .filter(([candidateCode]) => candidateCode !== roleCode)
      .map(([, candidateNames]) => candidateNames),
  ];
  const nameErrors = validateRoleNames(model, occupiedNames, names, roleCode);
  const descriptionErrors = validateRoleDescriptions(descriptions);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, []);

  const translateText = async (target: TranslationTarget) => {
    const text = target === "name" ? names["zh-CN"].trim() : descriptions["zh-CN"].trim();
    if (!text || translating) return;

    setTranslating(target);
    setTranslationFeedback((current) => ({ ...current, [target]: undefined }));
    try {
      const response = await fetch("/api/translate-role-name", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = (await response.json()) as {
        data?: { en?: unknown; ja?: unknown };
        message?: unknown;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.message === "string" ? payload.message : "无法翻译角色内容。",
        );
      }
      const translatedEn = payload.data?.en;
      const translatedJa = payload.data?.ja;
      if (typeof translatedEn !== "string" || typeof translatedJa !== "string") {
        throw new Error("翻译服务返回了无效结果。");
      }
      const maxLength = target === "name" ? 100 : 500;
      if (translatedEn.length > maxLength || translatedJa.length > maxLength) {
        throw new Error(`翻译结果超过 ${maxLength} 个字符，请缩短中文内容后重试。`);
      }

      if (target === "name") {
        setNames((current) => ({ ...current, en: translatedEn, ja: translatedJa }));
      } else {
        setDescriptions((current) => ({ ...current, en: translatedEn, ja: translatedJa }));
      }
      setTranslationFeedback((current) => ({
        ...current,
        [target]: {
          kind: "success",
          message: target === "name" ? "已填充英文和日文名称" : "已填充英文和日文描述",
        },
      }));
    } catch (error) {
      setTranslationFeedback((current) => ({
        ...current,
        [target]: {
          kind: "error",
          message: error instanceof Error ? error.message : "无法翻译角色内容。",
        },
      }));
    } finally {
      setTranslating(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (codeError || Object.keys(nameErrors).length || Object.keys(descriptionErrors).length)
      return;
    const nextCode = code.trim();
    onDraftChange(updateExistingRole(draft, model, roleCode, nextCode, names, descriptions));
    onSaved(nextCode);
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="edit-existing-role-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form className={`${styles.form} ${styles.compactForm}`} onSubmit={submit} noValidate>
        <header className={styles.header}>
          <div>
            <h2 id="edit-existing-role-dialog-title">编辑角色</h2>
            <p className={styles.dialogSubtitle}>{roleLabel}</p>
          </div>
          <button
            className={styles.close}
            type="button"
            aria-label="关闭编辑角色弹窗"
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        <div className={`${styles.body} ${styles.compactBody} ${styles.existingRoleFields}`}>
          <p className={styles.roleCodeWarning}>
            修改后旧编码将不再匹配。合并前请确认现有用户和邀请记录中的角色编码已完成兼容或迁移。
          </p>
          <label className={styles.compactField}>
            <span>角色编码</span>
            <input
              type="text"
              aria-label="修改后的角色编码"
              aria-invalid={Boolean(attempted && codeError)}
              aria-describedby={
                attempted && codeError ? "edit-role-code-error" : "edit-role-code-help"
              }
              value={code}
              maxLength={200}
              autoFocus
              onChange={(event) => setCode(event.target.value)}
            />
            {attempted && codeError ? (
              <small id="edit-role-code-error" role="alert">
                {codeError}
              </small>
            ) : (
              <small id="edit-role-code-help">
                必须以 preset_ 开头，仅支持小写字母、数字和下划线
              </small>
            )}
          </label>
          {nameFields.map(({ locale, field, label }) => {
            const error = attempted ? nameErrors[field] : undefined;
            const errorId = `edit-role-${locale}-name-error`;
            return (
              <div className={styles.compactField} key={locale}>
                <div className={styles.nameFieldHeader}>
                  <label htmlFor={`edit-role-${locale}-name`}>{label}</label>
                  {locale === "zh-CN" ? (
                    <button
                      className={styles.translateButton}
                      type="button"
                      aria-label="将中文名称翻译为英文和日文"
                      disabled={!names["zh-CN"].trim() || translating !== null}
                      onClick={() => void translateText("name")}
                    >
                      {translating === "name" ? "翻译中…" : "翻译英/日"}
                    </button>
                  ) : null}
                </div>
                <input
                  id={`edit-role-${locale}-name`}
                  type="text"
                  aria-label={`角色${label}`}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  value={names[locale]}
                  maxLength={100}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [locale]: event.target.value }))
                  }
                />
                {error ? (
                  <small id={errorId} role="alert">
                    {error}
                  </small>
                ) : null}
                {locale === "zh-CN" && translationFeedback.name ? (
                  <small
                    className={
                      translationFeedback.name.kind === "success"
                        ? styles.translationSuccess
                        : undefined
                    }
                    role={translationFeedback.name.kind === "error" ? "alert" : "status"}
                  >
                    {translationFeedback.name.message}
                  </small>
                ) : null}
              </div>
            );
          })}
          {descriptionFields.map(({ locale, field, label }) => {
            const error = attempted ? descriptionErrors[field] : undefined;
            const errorId = `edit-role-${locale}-description-error`;
            const inputId = `edit-role-${locale}-description`;
            return (
              <div className={styles.compactField} key={locale}>
                <div className={styles.nameFieldHeader}>
                  <label htmlFor={inputId}>{label}</label>
                  {locale === "zh-CN" ? (
                    <button
                      className={styles.translateButton}
                      type="button"
                      aria-label="将中文描述翻译为英文和日文"
                      disabled={!descriptions["zh-CN"].trim() || translating !== null}
                      onClick={() => void translateText("description")}
                    >
                      {translating === "description" ? "翻译中…" : "翻译英/日"}
                    </button>
                  ) : null}
                </div>
                <textarea
                  id={inputId}
                  aria-label={`角色${label}`}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  value={descriptions[locale]}
                  maxLength={500}
                  onChange={(event) =>
                    setDescriptions((current) => ({
                      ...current,
                      [locale]: event.target.value,
                    }))
                  }
                />
                {error ? (
                  <small id={errorId} role="alert">
                    {error}
                  </small>
                ) : null}
                {locale === "zh-CN" && translationFeedback.description ? (
                  <small
                    className={
                      translationFeedback.description.kind === "success"
                        ? styles.translationSuccess
                        : undefined
                    }
                    role={translationFeedback.description.kind === "error" ? "alert" : "status"}
                  >
                    {translationFeedback.description.message}
                  </small>
                ) : null}
              </div>
            );
          })}
        </div>

        <footer className={styles.actions}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className={styles.primary} type="submit">
            保存角色修改
          </button>
        </footer>
      </form>
    </dialog>
  );
}
