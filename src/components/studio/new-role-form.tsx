"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  DualListEditor,
  type TransferLabels,
  type TransferRequest,
} from "@/src/components/studio/dual-list-editor";
import styles from "@/src/components/studio/new-role-form.module.css";
import { addNewRole, updateNewRole, type PermissionDraft } from "@/src/domain/draft";
import { buildPermissionTransferItems } from "@/src/domain/editor-view";
import type { PermissionStudioModel } from "@/src/domain/model";
import {
  defaultPermissionStudioLocale,
  type PermissionStudioLocale,
} from "@/src/domain/model-i18n";
import {
  validateNewRole,
  type NewRoleDescriptions,
  type NewRoleDraft,
  type NewRoleField,
  type NewRoleNames,
} from "@/src/domain/new-role";

export interface NewRoleFormProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  locale?: PermissionStudioLocale;
  initialRole?: NewRoleDraft;
  onDraftChange: (draft: PermissionDraft) => void;
  onCancel: () => void;
  onCreated: (roleCode: string) => void;
}

const labels: TransferLabels = {
  search: "搜索权限",
  groupFilter: "权限分组",
  groupPlaceholder: "选择分组",
  clearGroupFilter: "清空权限分组",
  available: "可添加权限",
  assigned: "初始权限",
  assignSelected: "添加已选权限",
  unassignSelected: "移除已选权限",
  empty: "没有匹配的权限",
  actions: "权限转移操作",
  noSelection: "请先选择权限",
  moved: (direction, count) =>
    direction === "assign" ? `已添加 ${count} 项权限` : `已移除 ${count} 项权限`,
};

const nameFields = [
  { locale: "zh-CN", field: "nameZhCn", label: "中文名称" },
  { locale: "en", field: "nameEn", label: "英文名称" },
  { locale: "ja", field: "nameJa", label: "日文名称" },
] as const;

const descriptionFields = [
  { locale: "zh-CN", field: "descriptionZhCn", label: "中文描述" },
  { locale: "en", field: "descriptionEn", label: "英文描述" },
  { locale: "ja", field: "descriptionJa", label: "日文描述" },
] as const;

type TranslationTarget = "name" | "description";

export function NewRoleForm({
  model,
  draft,
  locale = defaultPermissionStudioLocale,
  initialRole,
  onDraftChange,
  onCancel,
  onCreated,
}: NewRoleFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [roleId, setRoleId] = useState(initialRole ? String(initialRole.roleId) : "");
  const [code, setCode] = useState(initialRole?.code ?? "preset_");
  const [names, setNames] = useState<NewRoleNames>(
    initialRole?.names ?? { en: "", "zh-CN": "", ja: "" },
  );
  const [descriptions, setDescriptions] = useState<NewRoleDescriptions>(
    initialRole?.descriptions ??
      (initialRole ? { ...initialRole.names } : { en: "", "zh-CN": "", ja: "" }),
  );
  const [permissionCodes, setPermissionCodes] = useState<string[]>(
    initialRole?.permissionCodes ?? [],
  );
  const [attempted, setAttempted] = useState(false);
  const [translating, setTranslating] = useState<TranslationTarget | null>(null);
  const [translationFeedback, setTranslationFeedback] = useState<
    Partial<Record<TranslationTarget, { kind: "success" | "error"; message: string }>>
  >({});
  const input = { roleId: Number(roleId), code, names, descriptions, permissionCodes };
  const otherNewRoles = initialRole
    ? draft.newRoles.filter((role) => role.code !== initialRole.code)
    : draft.newRoles;
  const errors = validateNewRole(model, otherNewRoles, input);
  const assignedSet = useMemo(() => new Set(permissionCodes), [permissionCodes]);
  const available = buildPermissionTransferItems(
    model,
    model.permissionCodes.filter((permission) => !assignedSet.has(permission)),
    locale,
  );
  const assigned = buildPermissionTransferItems(
    model,
    model.permissionCodes.filter((permission) => assignedSet.has(permission)),
    locale,
  );
  const visibleError = (field: NewRoleField, value: string) =>
    attempted || value.trim().length > 0 ? errors[field] : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, []);

  const transfer = (request: TransferRequest) => {
    const next = new Set(permissionCodes);
    for (const id of request.ids) {
      if (request.direction === "assign") next.add(id);
      else next.delete(id);
    }
    setPermissionCodes([...next].sort());
  };

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
    if (Object.keys(errors).length) return;
    const next = initialRole
      ? updateNewRole(draft, model, initialRole.code, input)
      : addNewRole(draft, model, input);
    onDraftChange(next);
    onCreated(input.code.trim());
  };

  const idError = visibleError("roleId", roleId);
  const codeError = visibleError("code", code === "preset_" ? "" : code);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="new-role-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <header className={styles.header}>
          <div>
            <h2 id="new-role-dialog-title">{initialRole ? "编辑角色" : "新增角色"}</h2>
          </div>
          <button
            className={styles.close}
            type="button"
            aria-label={initialRole ? "关闭编辑角色弹窗" : "关闭新增角色弹窗"}
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        <div className={`${styles.body} ${styles.newRoleBody}`}>
          <fieldset className={styles.identity}>
            <legend>角色信息</legend>
            <label className={styles.codeField}>
              <span>角色编码</span>
              <input
                type="text"
                aria-label="新角色编码"
                aria-invalid={Boolean(codeError)}
                aria-describedby={codeError ? "new-role-code-error" : undefined}
                value={code}
                maxLength={200}
                onChange={(event) => setCode(event.target.value)}
              />
              {codeError ? (
                <small id="new-role-code-error" role="alert">
                  {codeError}
                </small>
              ) : null}
            </label>
            <label className={styles.idField}>
              <span>角色 ID</span>
              <input
                type="number"
                aria-label="新角色 ID"
                aria-invalid={Boolean(idError)}
                aria-describedby={idError ? "new-role-id-error" : "new-role-id-help"}
                value={roleId}
                min="1"
                max="999"
                step="1"
                onChange={(event) => setRoleId(event.target.value)}
              />
              {idError ? (
                <small id="new-role-id-error" role="alert">
                  {idError}
                </small>
              ) : (
                <small id="new-role-id-help">只能填写 1–999 的整数</small>
              )}
            </label>
            {nameFields.map(({ locale, field, label }) => {
              const error = visibleError(field, names[locale]);
              const errorId = `new-role-${locale}-name-error`;
              const inputId = `new-role-${locale}-name`;
              return (
                <div className={styles.nameField} key={locale}>
                  <div className={styles.nameFieldHeader}>
                    <label htmlFor={inputId}>{label}</label>
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
                    id={inputId}
                    type="text"
                    aria-label={`新角色${label}`}
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
              const error = visibleError(field, descriptions[locale]);
              const errorId = `new-role-${locale}-description-error`;
              const inputId = `new-role-${locale}-description`;
              return (
                <div className={styles.descriptionField} key={locale}>
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
                    aria-label={`新角色${label}`}
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
          </fieldset>

          <section className={styles.permissions} aria-labelledby="new-role-permissions-heading">
            <div className={styles.permissionsHeading}>
              <div>
                <h3 id="new-role-permissions-heading">初始权限</h3>
                <p>可先创建空角色，也可以在这里一次性完成权限分配。</p>
              </div>
              <strong>{permissionCodes.length} 项</strong>
            </div>
            <DualListEditor
              ariaLabel="新角色的初始权限"
              available={available}
              assigned={assigned}
              labels={labels}
              onTransfer={transfer}
              directActions={{ assign: "添加", unassign: "移除" }}
            />
          </section>
        </div>

        <footer className={styles.actions}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className={styles.primary} type="submit">
            {initialRole ? "保存角色修改" : "添加到变更草稿"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
