"use client";

import { useEffect, useMemo, useState } from "react";

import { ContractModuleGraph } from "@/src/components/studio/contract-module-graph";
import styles from "@/src/components/studio/contract-module-editor.module.css";
import { ContractModuleTreeList } from "@/src/components/studio/contract-module-tree-list";
import type { PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import {
  defaultPermissionStudioLocale,
  type PermissionStudioLocale,
} from "@/src/domain/model-i18n";

export interface ContractModuleEditorProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  locale?: PermissionStudioLocale;
  selectedContractType?: string;
  onSelectedContractTypeChange?: (contractType: string) => void;
  disabled?: boolean;
  onDraftChange: (draft: PermissionDraft) => void;
}

export function ContractModuleEditor({
  model,
  draft,
  locale = defaultPermissionStudioLocale,
  selectedContractType: initialContractType,
  onSelectedContractTypeChange,
  disabled = false,
  onDraftChange,
}: ContractModuleEditorProps) {
  const [view, setView] = useState<"list" | "graph">("list");
  const editableContracts = useMemo(
    () => model.contractTypes.filter((contractType) => contractType !== "TEST"),
    [model.contractTypes],
  );
  const firstContractType = editableContracts[0] ?? "";
  const [selectedContractType, setSelectedContractType] = useState(() =>
    editableContracts.includes(initialContractType ?? "")
      ? initialContractType!
      : firstContractType,
  );

  useEffect(() => {
    if (editableContracts.includes(initialContractType ?? "")) {
      setSelectedContractType(initialContractType!);
    } else if (!editableContracts.includes(selectedContractType)) {
      setSelectedContractType(firstContractType);
    }
  }, [editableContracts, firstContractType, initialContractType, selectedContractType]);

  return (
    <section className={styles.editor} aria-label="合同模块编辑器">
      <header className={styles.viewBar}>
        <div className={styles.viewSwitch} role="group" aria-label="合同模块视图">
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
            <svg aria-hidden="true" viewBox="0 0 18 18">
              <path d="M6.5 4h8M6.5 9h8M6.5 14h8" />
              <rect x="3" y="3" width="1.5" height="1.5" rx=".3" />
              <rect x="3" y="8" width="1.5" height="1.5" rx=".3" />
              <rect x="3" y="13" width="1.5" height="1.5" rx=".3" />
            </svg>
            列表
          </button>
          <button type="button" aria-pressed={view === "graph"} onClick={() => setView("graph")}>
            <svg aria-hidden="true" viewBox="0 0 18 18">
              <circle cx="4" cy="9" r="2" />
              <circle cx="14" cy="4" r="2" />
              <circle cx="14" cy="14" r="2" />
              <path d="m6 8 6-3M6 10l6 3" />
            </svg>
            画布
          </button>
        </div>
        <nav className={styles.sidebar} aria-label="可编辑合同">
          <ul className={styles.contractList}>
            {editableContracts.map((contractType) => (
              <li key={contractType}>
                <button
                  type="button"
                  aria-label={contractType}
                  aria-pressed={contractType === selectedContractType}
                  onClick={() => {
                    setSelectedContractType(contractType);
                    onSelectedContractTypeChange?.(contractType);
                  }}
                >
                  <span>{contractType}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div className={styles.content}>
        {selectedContractType ? (
          view === "list" ? (
            <ContractModuleTreeList
              model={model}
              draft={draft}
              locale={locale}
              contractType={selectedContractType}
              disabled={disabled}
              onDraftChange={onDraftChange}
            />
          ) : (
            <ContractModuleGraph
              model={model}
              draft={draft}
              locale={locale}
              contractType={selectedContractType}
              disabled={disabled}
              onDraftChange={onDraftChange}
            />
          )
        ) : (
          <p className={styles.empty}>没有可编辑的合同类型</p>
        )}
      </div>
    </section>
  );
}
