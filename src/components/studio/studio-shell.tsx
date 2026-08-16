"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { ChangeReview } from "@/src/components/studio/change-review";
import { ChangeTray } from "@/src/components/studio/change-tray";
import { ContractModuleEditor } from "@/src/components/studio/contract-module-editor";
import { PermissionSimulator } from "@/src/components/studio/permission-simulator";
import { PullRequestFlow } from "@/src/components/studio/pull-request-flow";
import { RolePermissionEditor } from "@/src/components/studio/role-permission-editor";
import styles from "@/src/components/studio/studio-shell.module.css";
import {
  ACTIVE_CHANGE_JOB_KEY,
  type ClientChangeJob,
} from "@/src/components/studio/use-change-job";
import { buildImpactDiff, createEmptyDraft, type PermissionDraft } from "@/src/domain/draft";
import {
  draftStorageKey,
  rebasePermissionDraft,
  restoreDraftSession,
  serializeDraftSession,
  type DraftConflict,
} from "@/src/domain/draft-session";
import { permissionStudioModelSchema, type PermissionStudioModel } from "@/src/domain/model";

type StudioTask = "roles" | "contracts" | "simulation";
type StudioView = "tasks" | "review" | "pr";

export interface StudioShellProps {
  initialModel?: PermissionStudioModel | null;
  loadModel?: () => Promise<PermissionStudioModel>;
}

const tasks: Array<{ id: StudioTask; label: string }> = [
  { id: "roles", label: "角色权限" },
  { id: "contracts", label: "合同模块" },
  { id: "simulation", label: "权限模拟" },
];

export async function loadRemoteModel(): Promise<PermissionStudioModel> {
  const response = await fetch("/api/model", { cache: "no-store" });
  if (!response.ok) throw new Error("Permission model request failed");
  const body = (await response.json()) as { data?: unknown };
  return permissionStudioModelSchema.parse(body.data);
}

function firstRole(model: PermissionStudioModel): string {
  return model.roles.find((role) => role.code.startsWith("preset_"))?.code ?? "";
}

function firstContract(model: PermissionStudioModel): string {
  return model.contractTypes.find((contractType) => contractType !== "TEST") ?? "";
}

function translatedRole(model: PermissionStudioModel, roleCode: string): string {
  const role = model.roles.find((candidate) => candidate.code === roleCode);
  return role ? (model.translations["zh-CN"][role.roleName] ?? roleCode) : roleCode;
}

function conflictKindLabel(conflict: DraftConflict): string {
  return {
    role: "角色",
    permission: "权限",
    contract: "合同",
    menu: "菜单",
    widget: "组件",
  }[conflict.kind];
}

export function StudioShell({
  initialModel = null,
  loadModel = loadRemoteModel,
}: StudioShellProps) {
  const [model, setModel] = useState<PermissionStudioModel | null>(initialModel);
  const [draft, setDraft] = useState<PermissionDraft>(() => createEmptyDraft());
  const [readyDraftSha, setReadyDraftSha] = useState<string | null>(null);
  const [task, setTask] = useState<StudioTask>("roles");
  const [view, setView] = useState<StudioView>("tasks");
  const [conflicts, setConflicts] = useState<DraftConflict[]>([]);
  const [loading, setLoading] = useState(!initialModel);
  const [loadError, setLoadError] = useState(false);
  const [selectedRoleCode, setSelectedRoleCode] = useState(() =>
    initialModel ? firstRole(initialModel) : "",
  );
  const [selectedContractType, setSelectedContractType] = useState(() =>
    initialModel ? firstContract(initialModel) : "",
  );
  const [activeJob, setActiveJob] = useState<ClientChangeJob | null>(null);
  const [hasStoredJob, setHasStoredJob] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowPending, setFlowPending] = useState(false);
  const skipRestoreSha = useRef<string | null>(null);
  const previousJob = useRef<ClientChangeJob | null>(null);

  const installInitialModel = useCallback((nextModel: PermissionStudioModel) => {
    setModel(nextModel);
    setSelectedRoleCode(firstRole(nextModel));
    setSelectedContractType(firstContract(nextModel));
    setLoadError(false);
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      installInitialModel(await loadModel());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [installInitialModel, loadModel]);

  useEffect(() => {
    if (!initialModel) void loadInitial();
  }, [initialModel, loadInitial]);

  useEffect(() => {
    if (!model) return;
    if (skipRestoreSha.current === model.sourceSha) {
      skipRestoreSha.current = null;
      setReadyDraftSha(model.sourceSha);
      return;
    }
    const restored = restoreDraftSession(
      window.sessionStorage.getItem(draftStorageKey(model.sourceSha)),
      model.sourceSha,
    );
    setDraft(restored?.draft ?? createEmptyDraft());
    setReadyDraftSha(model.sourceSha);
  }, [model?.sourceSha]);

  useEffect(() => {
    if (!model || readyDraftSha !== model.sourceSha) return;
    window.sessionStorage.setItem(
      draftStorageKey(model.sourceSha),
      serializeDraftSession({ version: 1, sourceSha: model.sourceSha, draft }),
    );
  }, [draft, model, readyDraftSha]);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(ACTIVE_CHANGE_JOB_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as { requestId?: unknown };
      if (typeof stored.requestId === "string" && stored.requestId) setHasStoredJob(true);
    } catch {
      window.sessionStorage.removeItem(ACTIVE_CHANGE_JOB_KEY);
    }
  }, []);

  useEffect(() => {
    if (!model) return;
    if (
      !model.roles.some((role) => role.code === selectedRoleCode && role.code.startsWith("preset_"))
    ) {
      setSelectedRoleCode(firstRole(model));
    }
    if (!model.contractTypes.includes(selectedContractType) || selectedContractType === "TEST") {
      setSelectedContractType(firstContract(model));
    }
  }, [model, selectedContractType, selectedRoleCode]);

  const refresh = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const nextModel = await loadModel();
      const rebased = model
        ? rebasePermissionDraft(model, nextModel, draft)
        : { draft: createEmptyDraft(), conflicts: [] };
      skipRestoreSha.current = nextModel.sourceSha;
      setModel(nextModel);
      setDraft(rebased.draft);
      setConflicts(rebased.conflicts);
      setReadyDraftSha(nextModel.sourceSha);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleJobChange = useCallback((job: ClientChangeJob | null) => {
    const prior = previousJob.current;
    previousJob.current = job;
    setActiveJob(job);
    if (job) setHasStoredJob(false);
    if (prior?.state === "completed" && !job) {
      setFlowOpen(false);
      setView("tasks");
      setTask("roles");
    }
  }, []);

  const impact = useMemo(
    () => (model ? buildImpactDiff(model, draft) : buildImpactDiffPlaceholder),
    [draft, model],
  );
  const jobActive = activeJob !== null || hasStoredJob || flowPending;
  const draftLocked = jobActive || loading;
  const currentObject =
    task === "roles" && selectedRoleCode
      ? { scenario: `role:${selectedRoleCode}`, label: translatedRole(model!, selectedRoleCode) }
      : task === "contracts" && selectedContractType
        ? { scenario: `contract:${selectedContractType}`, label: `合同 ${selectedContractType}` }
        : undefined;

  if (!model) {
    return (
      <section className={styles.modelState} aria-live="polite">
        <p className="eyebrow">PERMISSION MODEL</p>
        <h2>{loadError ? "无法加载权限模型" : "正在读取 develop 权限…"}</h2>
        {loadError ? (
          <button type="button" disabled={loading} onClick={() => void loadInitial()}>
            重试加载
          </button>
        ) : null}
      </section>
    );
  }

  const showFlow = flowOpen || activeJob !== null || hasStoredJob || flowPending;
  const openTask = (nextTask: StudioTask) => {
    setTask(nextTask);
    setView("tasks");
    if (!jobActive) setFlowOpen(false);
  };
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, current: StudioTask) => {
    const currentIndex = tasks.findIndex((item) => item.id === current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tasks.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tasks.length) % tasks.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tasks.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTask = tasks[nextIndex]!.id;
    openTask(nextTask);
    document.getElementById(`studio-tab-${nextTask}`)?.focus();
  };

  return (
    <section className={styles.studio} aria-labelledby="studio-heading">
      <header className={styles.header}>
        <div>
          <p className="eyebrow">PERMISSION STUDIO</p>
          <h2 id="studio-heading">权限变更工作台</h2>
          <p className={styles.sourceSha}>
            来源 SHA：<code>{model.sourceSha}</code>
          </p>
        </div>
        <button type="button" disabled={loading || jobActive} onClick={() => void refresh()}>
          {loading ? "刷新中…" : "刷新 develop"}
        </button>
      </header>

      {loadError ? <p role="alert">刷新失败，当前仍显示已加载的来源版本。请稍后重试。</p> : null}
      {jobActive ? (
        <p className={styles.jobNotice} role="status">
          存在进行中的变更任务，角色与合同编辑已锁定。
        </p>
      ) : null}
      {conflicts.length ? (
        <section className={styles.conflicts} aria-labelledby="draft-conflicts-heading">
          <div className={styles.conflictHeader}>
            <h3 id="draft-conflicts-heading">{conflicts.length} 项草稿冲突需要处理</h3>
            <button type="button" onClick={() => setConflicts([])}>
              已处理冲突
            </button>
          </div>
          <ul>
            {conflicts.map((conflict) => (
              <li key={`${conflict.kind}:${conflict.ownerCode}:${conflict.code}`}>
                {conflictKindLabel(conflict)} {conflict.ownerCode}：<code>{conflict.code}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className={styles.tabs} role="tablist" aria-label="权限工作区">
        {tasks.map((item) => (
          <button
            key={item.id}
            id={`studio-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={task === item.id}
            aria-controls={`studio-panel-${item.id}`}
            tabIndex={task === item.id ? 0 : -1}
            onClick={() => openTask(item.id)}
            onKeyDown={(event) => navigateTabs(event, item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tasks.map((item) => (
        <section
          key={item.id}
          id={`studio-panel-${item.id}`}
          className={styles.panel}
          role="tabpanel"
          aria-labelledby={`studio-tab-${item.id}`}
          hidden={view !== "tasks" || task !== item.id}
        >
          {item.id === "roles" ? (
            <fieldset className={styles.editorLock} disabled={draftLocked}>
              <RolePermissionEditor
                model={model}
                draft={draft}
                selectedRoleCode={selectedRoleCode}
                onSelectedRoleCodeChange={setSelectedRoleCode}
                onDraftChange={setDraft}
              />
            </fieldset>
          ) : null}
          {item.id === "contracts" ? (
            <div className={styles.editorLock} aria-disabled={draftLocked || undefined}>
              <ContractModuleEditor
                model={model}
                draft={draft}
                selectedContractType={selectedContractType}
                onSelectedContractTypeChange={setSelectedContractType}
                disabled={draftLocked}
                onDraftChange={setDraft}
              />
            </div>
          ) : null}
          {item.id === "simulation" ? <PermissionSimulator model={model} draft={draft} /> : null}
        </section>
      ))}

      {view === "review" ? (
        <section className={styles.auxiliary} aria-label="变更审查">
          <header className={styles.auxiliaryHeader}>
            <button type="button" onClick={() => setView("tasks")}>
              返回编辑
            </button>
            <button
              type="button"
              disabled={draftLocked}
              onClick={() => {
                setFlowOpen(true);
                setView("pr");
              }}
            >
              继续生成 Draft PR
            </button>
          </header>
          <ChangeReview
            model={model}
            draft={draft}
            onDraftChange={setDraft}
            disabled={draftLocked}
          />
        </section>
      ) : null}

      {showFlow ? (
        <div className={styles.auxiliary}>
          {view === "pr" && !activeJob ? (
            <button
              type="button"
              disabled={flowPending}
              onClick={() => {
                setFlowOpen(false);
                setView("review");
              }}
            >
              返回变更检查
            </button>
          ) : null}
          <PullRequestFlow
            model={model}
            draft={draft}
            impact={impact}
            stale={conflicts.length > 0}
            pending={loading}
            onDraftChange={setDraft}
            onJobChange={handleJobChange}
            onPendingChange={setFlowPending}
          />
        </div>
      ) : null}

      <ChangeTray
        impact={impact}
        currentObject={view === "tasks" ? currentObject : undefined}
        disabled={draftLocked}
        reviewDisabled={loading}
        generatePrDisabled={conflicts.length > 0}
        onDiscardAll={() => setDraft(createEmptyDraft())}
        onReview={() => setView("review")}
        onGeneratePr={() => {
          setFlowOpen(true);
          setView("pr");
        }}
      />
    </section>
  );
}

const buildImpactDiffPlaceholder = {
  addedRolePermissions: [],
  removedRolePermissions: [],
  addedContractOwners: [],
  removedContractOwners: [],
  scenarios: [],
};
