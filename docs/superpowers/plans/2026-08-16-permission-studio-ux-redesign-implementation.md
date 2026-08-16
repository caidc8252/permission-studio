# Permission Studio UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-in-one permission page with focused role and contract editors, accessible dual-list drag and drop, draft-aware simulation, and a business-oriented Draft PR review flow.

**Architecture:** Keep the existing model loader, domain permission rules, validation jobs, Git worktrees, and GitHub CLI finalization. Move shared draft ownership into `StudioShell`, keep projections and mutations pure in `src/domain`, and split the UI into independent role, contract, simulator, review, and job-flow components connected by explicit typed props.

**Tech Stack:** Next.js 16.2.6, React 19.2.4, TypeScript 5.9.3, Zod 4.4.3, Vitest 4.1.6, Testing Library, CSS Modules, `@atlaskit/pragmatic-drag-and-drop` 3.0.0, local Git, and GitHub CLI.

## Global Constraints

- Run with Node.js `>=24`, pnpm `>=10`, and the existing fixed localhost origin `http://127.0.0.1:3100`.
- Keep the target repository fixed to `Newland-Payment-Technology-US-Co-Ltd/pep-webapp` and the base branch fixed to `develop`.
- Only global `preset_*` roles and non-`TEST` contract menus/widgets are editable.
- Keep `MEMBER` and `ADMIN` as simulation membership types; never render them as editable roles.
- Keep all existing fail-closed AST, path allowlist, source-SHA, non-force-push, Draft PR, and credential-boundary guarantees.
- Pointer drag and drop is optional; every transfer must also work through checkboxes, buttons, and keyboard focus.
- The contract editor must render the real menu parent tree and a separate widget root group; it must not infer widget-to-menu relationships.
- Automated browser E2E is excluded. Tests and builds must never create a real remote branch or PR.
- Preserve UTF-8 Chinese UI text and provide text/icon meaning in addition to color.

---

## File map

### New domain files

- `src/domain/draft-session.ts`: validate, serialize, restore, and rebase a draft bound to one source SHA.
- `src/domain/editor-view.ts`: pure role-permission and contract-module editor projections.

### New shared UI files

- `src/components/studio/dual-list-editor.tsx`: generic selection, transfer, pointer drag, focus, and announcements.
- `src/components/studio/dual-list-editor.module.css`: dual-list layout and drag states.
- `src/components/studio/role-permission-editor.tsx`: single-role editing workflow.
- `src/components/studio/contract-module-editor.tsx`: single-contract menu tree and widget group.
- `src/components/studio/permission-simulator.tsx`: extracted read-only simulation workflow.
- `src/components/studio/change-tray.tsx`: fixed cross-object draft summary.
- `src/components/studio/change-review.tsx`: structured role/contract business diff and undo controls.
- `src/components/studio/use-change-job.ts`: prepare, polling, confirmation, discard, and recovery state.
- `src/components/studio/pull-request-flow.tsx`: title/reason inputs, validation results, Git diff inspection, and final action.
- `src/components/studio/studio-shell.tsx`: model loading, task navigation, draft ownership, session restore, stale replay, and composition.
- `src/components/studio/studio-shell.module.css`: application shell, responsive workspace, review layout, and fixed tray.

### Existing files replaced or narrowed

- `src/domain/draft.ts`: add deterministic set/batch/undo primitives while retaining `PermissionDraft` and `buildPermissionChange`.
- `src/domain/change.ts`: add validated PR title metadata.
- `src/components/permission-workbench.tsx`: replaced by `StudioShell` composition, then removed.
- `src/components/change-draft.tsx`: split into `ChangeReview`, `useChangeJob`, and `PullRequestFlow`, then removed.
- `app/page.tsx`: render `StudioShell` instead of `PermissionWorkbench`.
- `app/globals.css`: retain page-level reset, hero, health card, and target footer styles; remove obsolete workbench/change-draft rules after migration.
- `app/api/changes/prepare/route.ts`: accept and validate PR title.
- `src/jobs/change-job-store.ts`: expose title in the public job response.
- `src/jobs/change-job-service.ts`: use the requested validated title when creating the Draft PR.
- `README.md`: document the three task areas, accessible transfer controls, and manual smoke test.

---

### Task 1: Deterministic batch draft operations and stale replay

**Files:**

- Modify: `src/domain/draft.ts:1-218`
- Modify: `src/domain/draft.test.ts:1-180`
- Create: `src/domain/draft-session.ts`
- Create: `src/domain/draft-session.test.ts`

**Interfaces:**

- Consumes: `PermissionDraft`, `PermissionStudioModel`, and the existing single-item validation rules.
- Produces:
  - `setRolePermissionMembership(draft, model, roleCode, permissionCodes): PermissionDraft`
  - `setContractOwnerMembership(draft, model, contractType, kind, ownerCodes): PermissionDraft`
  - `discardRoleDraft(draft, roleCode): PermissionDraft`
  - `discardContractDraft(draft, contractType): PermissionDraft`
  - `discardDraftItem(draft, model, item: DraftItemRef): PermissionDraft`
  - `draftStorageKey(sourceSha): string`
  - `serializeDraftSession(stored: StoredDraft): string`
  - `restoreDraftSession(raw, expectedSha): StoredDraft | null`
  - `rebasePermissionDraft(oldModel, newModel, draft): DraftRebaseResult`

- [ ] **Step 1: Write failing batch and undo tests**

```ts
it("sets a role permission batch deterministically and removes empty overrides", () => {
  const added = setRolePermissionMembership(empty, model, "preset_ops", [
    "orders.view",
    "orders.manage",
    "orders.manage",
  ]);
  expect(added.rolePermissions.preset_ops).toEqual(["orders.manage", "orders.view"]);

  const baseline = setRolePermissionMembership(
    added,
    model,
    "preset_ops",
    model.roles[0]!.permissionCodes,
  );
  expect(baseline.rolePermissions).toEqual({});
});

it("discards only one changed contract", () => {
  const changed = setContractOwnerMembership(empty, model, "ISO", "menu", []);
  expect(discardContractDraft(changed, "ISO")).toEqual(createEmptyDraft());
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm test -- src/domain/draft.test.ts`

Expected: FAIL because the set/discard exports do not exist.

- [ ] **Step 3: Implement validated set operations and granular undo**

```ts
export function setRolePermissionMembership(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  roleCode: string,
  permissionCodes: readonly string[],
): PermissionDraft {
  const role = editableRole(model, roleCode);
  const next = sortedUnique(permissionCodes);
  for (const code of next) {
    if (!model.permissionRegistry[code]) throw new Error(`Unknown permission "${code}"`);
  }
  const rolePermissions = { ...draft.rolePermissions };
  if (sameValues(next, role.permissionCodes)) delete rolePermissions[roleCode];
  else rolePermissions[roleCode] = next;
  return { ...draft, rolePermissions };
}

function editableRole(model: PermissionStudioModel, roleCode: string) {
  const role = model.roles.find((candidate) => candidate.code === roleCode);
  if (!role || !role.code.startsWith("preset_")) {
    throw new Error(`Role "${roleCode}" is not editable`);
  }
  return role;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

export function discardContractDraft(
  draft: PermissionDraft,
  contractType: string,
): PermissionDraft {
  const contractMenus = { ...draft.contractMenus };
  const contractWidgets = { ...draft.contractWidgets };
  delete contractMenus[contractType];
  delete contractWidgets[contractType];
  return { ...draft, contractMenus, contractWidgets };
}
```

Implement `setContractOwnerMembership` with the existing menu/widget validation, make `toggleRolePermission` and `toggleContractOwner` delegate to the set functions, and define `discardDraftItem(draft, model, item)` for one role permission, menu, or widget change by restoring that item's membership from the model baseline while preserving the other overrides for the same owner.

- [ ] **Step 4: Add failing session and stale replay tests**

```ts
it("restores only a draft stored for the expected source SHA", () => {
  const raw = serializeDraftSession({ version: 1, sourceSha: model.sourceSha, draft });
  expect(restoreDraftSession(raw, model.sourceSha)?.draft).toEqual(draft);
  expect(restoreDraftSession(raw, "f".repeat(40))).toBeNull();
});

it("replays valid codes and reports removed references", () => {
  const next = structuredClone(model);
  next.sourceSha = "f".repeat(40);
  delete next.permissionRegistry["orders.manage"];
  next.permissionCodes = next.permissionCodes.filter((code) => code !== "orders.manage");

  const result = rebasePermissionDraft(model, next, draftWithOrdersManage);
  expect(result.draft).toEqual(createEmptyDraft());
  expect(result.conflicts).toEqual([
    { kind: "permission", ownerCode: "preset_ops", code: "orders.manage" },
  ]);
});
```

- [ ] **Step 5: Implement schema-backed session storage and semantic replay**

```ts
export interface StoredDraft {
  version: 1;
  sourceSha: string;
  draft: PermissionDraft;
}

export interface DraftConflict {
  kind: "role" | "permission" | "contract" | "menu" | "widget";
  ownerCode: string;
  code: string;
}

export type DraftItemRef =
  | { kind: "permission"; ownerCode: string; code: string }
  | { kind: "menu" | "widget"; ownerCode: string; code: string };

export interface DraftRebaseResult {
  draft: PermissionDraft;
  conflicts: DraftConflict[];
}
```

Use a strict Zod schema with the existing identifier and collection limits. Rebase the semantic add/remove diff against `newModel`; preserve valid references, report missing references, and never map a removed code to a guessed replacement.

- [ ] **Step 6: Run domain tests**

Run: `pnpm test -- src/domain/draft.test.ts src/domain/draft-session.test.ts`

Expected: both files PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- src/domain/draft.ts src/domain/draft.test.ts src/domain/draft-session.ts src/domain/draft-session.test.ts
git commit -m "feat(domain): add batch permission draft operations"
```

---

### Task 2: Accessible generic dual-list transfer component

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/components/studio/dual-list-editor.tsx`
- Create: `src/components/studio/dual-list-editor.module.css`
- Create: `src/components/studio/dual-list-editor.test.tsx`

**Interfaces:**

- Consumes: presentational `TransferItem[]` and one semantic `onTransfer` callback.
- Produces:

```ts
export interface TransferItem {
  id: string;
  label: string;
  description?: string;
  group: string;
  depth?: number;
  kind?: "permission" | "menu" | "widget";
}

export interface TransferRequest {
  direction: "assign" | "unassign";
  ids: string[];
}

export interface TransferLabels {
  search: string;
  available: string;
  assigned: string;
  assignSelected: string;
  unassignSelected: string;
  empty: string;
  actions: string;
  dragHandle: (item: TransferItem) => string;
  dragPreview: (count: number) => string;
  noSelection: string;
  moved: (direction: TransferRequest["direction"], count: number) => string;
  sameSideDrop: string;
}
```

`DualListEditorProps` requires a `labels: TransferLabels` prop. The role editor
uses permission wording; the contract editor supplies module wording without
forking the component.

- [ ] **Step 1: Install the exact drag core dependency**

Run: `pnpm add @atlaskit/pragmatic-drag-and-drop@3.0.0`

Expected: `package.json` contains the exact dependency and the lockfile resolves it without peer errors.

- [ ] **Step 2: Write failing button, selection, and announcement tests**

```tsx
it("moves the selected rows with the explicit assign button", async () => {
  const user = userEvent.setup();
  const onTransfer = vi.fn();
  render(<DualListEditor {...props} onTransfer={onTransfer} />);

  await user.click(screen.getByRole("checkbox", { name: "邀请成员" }));
  await user.click(screen.getByRole("button", { name: "添加已选权限" }));

  expect(onTransfer).toHaveBeenCalledWith({ direction: "assign", ids: ["user.invite"] });
  expect(screen.getByRole("status")).toHaveTextContent("已添加 1 项");
});

it("supports search without changing assignment", async () => {
  const user = userEvent.setup();
  render(<DualListEditor {...props} />);
  await user.type(screen.getByRole("searchbox", { name: "搜索权限" }), "report");
  expect(screen.getByText("导出数据")).toBeVisible();
  expect(screen.queryByText("邀请成员")).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run the component test and verify failure**

Run: `pnpm test -- src/components/studio/dual-list-editor.test.tsx`

Expected: FAIL because `DualListEditor` does not exist.

- [ ] **Step 4: Implement selection, grouped lists, controls, focus, and live status**

```tsx
export function DualListEditor({
  ariaLabel,
  available,
  assigned,
  onTransfer,
  renderItem = defaultRenderItem,
}: DualListEditorProps) {
  const [availableSelection, setAvailableSelection] = useState<Set<string>>(new Set());
  const [assignedSelection, setAssignedSelection] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");

  const transfer = (direction: TransferRequest["direction"], ids: readonly string[]) => {
    const unique = [...new Set(ids)].sort();
    if (!unique.length) return setAnnouncement("没有可移动的项目");
    onTransfer({ direction, ids: unique });
    setAnnouncement(`${direction === "assign" ? "已添加" : "已移除"} ${unique.length} 项`);
    queueMicrotask(() => destinationRefs.current.get(unique[0]!)?.focus());
  };

  return (
    <section aria-label={ariaLabel} className={styles.transfer}>
      <TransferPanel
        side="available"
        label={labels.available}
        items={available}
        selection={availableSelection}
        onSelectionChange={setAvailableSelection}
        onMove={() => transfer("assign", [...availableSelection])}
        itemRefs={sourceRefs}
        renderItem={renderItem}
      />
      <div className={styles.actions}>
        <button
          type="button"
          disabled={!availableSelection.size}
          onClick={() => transfer("assign", [...availableSelection])}
        >
          {labels.assignSelected}
        </button>
        <button
          type="button"
          disabled={!assignedSelection.size}
          onClick={() => transfer("unassign", [...assignedSelection])}
        >
          {labels.unassignSelected}
        </button>
      </div>
      <TransferPanel
        side="assigned"
        label={labels.assigned}
        items={assigned}
        selection={assignedSelection}
        onSelectionChange={setAssignedSelection}
        onMove={() => transfer("unassign", [...assignedSelection])}
        itemRefs={destinationRefs}
        renderItem={renderItem}
      />
      <p role="status" aria-live="polite" className={styles.srOnly}>
        {announcement}
      </p>
    </section>
  );
}
```

Render native checkbox controls inside grouped list sections. Keep expansion controls and selection controls separate. Disable assign/remove buttons when their source selection is empty.

- [ ] **Step 5: Write a failing drag adapter test**

Mock `draggable`, `dropTargetForElements`, and `monitorForElements`; capture the monitor's `onDrop`, invoke it with a selected source ID and the opposite panel target, and expect the same `TransferRequest` as the button path.

```tsx
expect(onTransfer).toHaveBeenCalledWith({
  direction: "assign",
  ids: ["report.export", "user.invite"],
});
```

- [ ] **Step 6: Register handle-only pointer drag and panel drop targets**

```ts
return combine(
  draggable({
    element: row,
    dragHandle: handle,
    getInitialData: () => ({ type: "transfer-item", side, id }),
  }),
  dropTargetForElements({
    element: panel,
    getData: () => ({ type: "transfer-panel", side }),
  }),
);
```

The global monitor accepts only internal `transfer-item` data and the opposite `transfer-panel`. A same-side drop announces a no-op. Drag state adds a visible source opacity, destination outline, grab/grabbing cursor, and custom preview count for multi-selection.

- [ ] **Step 7: Run the component test**

Run: `pnpm test -- src/components/studio/dual-list-editor.test.tsx`

Expected: PASS for button, search, focus, live announcement, opposite-panel drag, and same-panel no-op cases.

- [ ] **Step 8: Commit**

```powershell
git add -- package.json pnpm-lock.yaml src/components/studio/dual-list-editor.tsx src/components/studio/dual-list-editor.module.css src/components/studio/dual-list-editor.test.tsx
git commit -m "feat(ui): add accessible dual-list transfer"
```

---

### Task 3: Focused single-role permission editor

**Files:**

- Create: `src/domain/editor-view.ts`
- Create: `src/domain/editor-view.test.ts`
- Create: `src/components/studio/role-permission-editor.tsx`
- Create: `src/components/studio/role-permission-editor.test.tsx`
- Create: `src/components/studio/role-permission-editor.module.css`

**Interfaces:**

- Consumes: `model`, `draft`, `selectedRoleCode`, and `onDraftChange`.
- Produces:
  - `buildRoleEditorView(model, draft, roleCode): RoleEditorView`
  - a searchable role sidebar and `DualListEditor` for the selected role.

- [ ] **Step 1: Write failing projection tests**

```ts
it("projects translated assigned and available permissions for one preset role", () => {
  const view = buildRoleEditorView(model, createEmptyDraft(), "preset_ops");
  expect(view.assigned.map(({ id }) => id)).toEqual(["orders.view"]);
  expect(view.available.map(({ id }) => id)).toEqual(["orders.manage"]);
  expect(view.assigned[0]).toMatchObject({
    label: "查看订单",
    group: "订单",
    kind: "permission",
  });
});

it("rejects a non-preset role", () => {
  expect(() => buildRoleEditorView(modelWithPrivateRole, empty, "custom_ops")).toThrow(
    "not editable",
  );
});
```

- [ ] **Step 2: Implement the pure role projection**

Build the current membership from `draft.rolePermissions[roleCode] ?? role.permissionCodes`, translate with `zh-CN` and code fallbacks, group by `belongToMenuCode`, and sort groups by menu order then permission code.

```ts
export interface RoleEditorView {
  roleCode: string;
  roleLabel: string;
  roleDescription: string;
  available: TransferItem[];
  assigned: TransferItem[];
}
```

- [ ] **Step 3: Run projection tests**

Run: `pnpm test -- src/domain/editor-view.test.ts`

Expected: PASS.

- [ ] **Step 4: Write failing role-editor interaction tests**

```tsx
it("edits only the selected role and preserves other role changes", async () => {
  const user = userEvent.setup();
  const onDraftChange = vi.fn();
  render(<RolePermissionEditor model={model} draft={draft} onDraftChange={onDraftChange} />);

  await user.click(screen.getByRole("checkbox", { name: "管理订单" }));
  await user.click(screen.getByRole("button", { name: "添加已选权限" }));

  expect(onDraftChange).toHaveBeenCalledWith(
    expect.objectContaining({ rolePermissions: { preset_ops: ["orders.manage", "orders.view"] } }),
  );
});

it("does not render membership types as roles", () => {
  render(<RolePermissionEditor model={model} draft={empty} onDraftChange={vi.fn()} />);
  expect(screen.queryByText("ADMIN")).not.toBeInTheDocument();
  expect(screen.queryByText("MEMBER")).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Implement role sidebar, filters, transfer, and deltas**

Use local state only for selected role, role query, permission query, group filter, and changes-only filter. Use `setRolePermissionMembership` for every transfer. Show pending counts from `buildImpactDiff` beside each role.

- [ ] **Step 6: Run role tests**

Run: `pnpm test -- src/domain/editor-view.test.ts src/components/studio/role-permission-editor.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- src/domain/editor-view.ts src/domain/editor-view.test.ts src/components/studio/role-permission-editor.tsx src/components/studio/role-permission-editor.test.tsx src/components/studio/role-permission-editor.module.css
git commit -m "feat(ui): add focused role permission editor"
```

---

### Task 4: Contract menu tree and widget transfer editor

**Files:**

- Modify: `src/domain/editor-view.ts`
- Modify: `src/domain/editor-view.test.ts`
- Create: `src/components/studio/contract-module-editor.tsx`
- Create: `src/components/studio/contract-module-editor.test.tsx`
- Create: `src/components/studio/contract-module-editor.module.css`

**Interfaces:**

- Consumes: `model`, `draft`, selected contract, and `DualListEditor`.
- Produces: `buildContractEditorView(model, draft, contractType): ContractEditorView` with flattened real menu nodes and separate widget nodes.

- [ ] **Step 1: Write failing menu-tree and widget-group tests**

```ts
it("flattens the real menu tree and keeps widgets in a separate root group", () => {
  const view = buildContractEditorView(modelWithNestedMenuAndWidget, empty, "ISO");
  expect(view.assigned).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "orders", kind: "menu", depth: 0 }),
      expect.objectContaining({ id: "orders.history", kind: "menu", depth: 1 }),
      expect.objectContaining({ id: "widget.quick", kind: "widget", group: "Widgets" }),
    ]),
  );
  expect(view.assigned.find(({ id }) => id === "widget.quick")?.depth).toBe(0);
});

it("never exposes TEST as editable", () => {
  expect(() => buildContractEditorView(model, empty, "TEST")).toThrow("read-only");
});
```

- [ ] **Step 2: Implement the contract projection**

Walk `menuRegistry.parentMenuCode` with cycle-safe visited sets, ordered by `order` then code. Produce menu nodes under the `Menus` root and widget owner codes under the `Widgets` root. Do not derive a widget parent from code prefixes.

- [ ] **Step 3: Run projection tests**

Run: `pnpm test -- src/domain/editor-view.test.ts`

Expected: PASS.

- [ ] **Step 4: Write failing contract-editor tests**

```tsx
it("moves selected menus and widgets without fabricating related codes", async () => {
  const user = userEvent.setup();
  const onDraftChange = vi.fn();
  render(<ContractModuleEditor model={model} draft={empty} onDraftChange={onDraftChange} />);

  await user.click(screen.getByRole("checkbox", { name: "快捷组件" }));
  await user.click(screen.getByRole("button", { name: "启用已选模块" }));

  expect(onDraftChange).toHaveBeenCalledWith(
    expect.objectContaining({ contractWidgets: { ISO: ["widget.quick"] } }),
  );
  expect(onDraftChange.mock.lastCall?.[0].contractMenus).toEqual({});
});
```

Add a separate test that expands/collapses a menu branch without changing the draft, and a test that selecting a branch selects only its currently displayed menu descendants before an explicit transfer.

- [ ] **Step 5: Implement contract sidebar, tree rendering, and typed transfer**

Split transferred IDs by `kind` and call `setContractOwnerMembership` once for menus and once for widgets. Preserve the other kind and other contracts. Label center buttons “启用已选模块” and “移除已选模块”.

- [ ] **Step 6: Run contract tests**

Run: `pnpm test -- src/domain/editor-view.test.ts src/components/studio/contract-module-editor.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- src/domain/editor-view.ts src/domain/editor-view.test.ts src/components/studio/contract-module-editor.tsx src/components/studio/contract-module-editor.test.tsx src/components/studio/contract-module-editor.module.css
git commit -m "feat(ui): add focused contract module editor"
```

---

### Task 5: Extract draft-aware permission simulation

**Files:**

- Create: `src/components/studio/permission-simulator.tsx`
- Create: `src/components/studio/permission-simulator.test.tsx`
- Create: `src/components/studio/permission-simulator.module.css`
- Modify: `src/domain/workbench.ts:1-134`
- Modify: `src/domain/workbench.test.ts:1-110`

**Interfaces:**

- Consumes: baseline `model` and shared `draft`.
- Produces: the existing simulation controls and evidence based on `applyDraftToModel(model, draft)`.

- [ ] **Step 1: Write a failing draft-preview test**

```tsx
it("calculates simulation from the draft-applied model", () => {
  render(<PermissionSimulator model={model} draft={draftAddingOrdersManage} />);
  expect(screen.getByText("正在预览草稿")).toBeVisible();
  expect(screen.getByLabelText("orders.manage evidence")).toHaveTextContent("Roles: preset_ops");
});

it("labels membership type separately from roles", () => {
  render(<PermissionSimulator model={model} draft={empty} />);
  expect(screen.getByRole("group", { name: "成员类型（仅用于模拟）" })).toBeVisible();
  expect(screen.getByRole("group", { name: "角色组合" })).toBeVisible();
});
```

- [ ] **Step 2: Run the simulator test and verify failure**

Run: `pnpm test -- src/components/studio/permission-simulator.test.tsx`

Expected: FAIL because the extracted component does not exist.

- [ ] **Step 3: Move simulation state and rendering into the focused component**

```tsx
const previewModel = useMemo(() => applyDraftToModel(model, draft), [model, draft]);
const view = useMemo(
  () => buildWorkbenchView(previewModel, { membershipType, entitlements, roleCodes }),
  [previewModel, membershipType, entitlements, roleCodes],
);
const previewingDraft = buildImpactDiff(model, draft).scenarios.length > 0;
```

Retain effective/blocked text states, permission evidence, menu tree, widgets, search, entitlement controls, plans, and role combinations. Reset only invalid simulation selections when a refreshed model removes their codes.

- [ ] **Step 4: Keep domain view output sufficient for grouped UI**

Extend `WorkbenchPermission` with `ownerLabel: string` and `WorkbenchMenu` with `depth: number`. Calculate both in `buildWorkbenchView`, assert translated owner labels and menu depths in `workbench.test.ts`, and keep relationship lookup out of React components.

- [ ] **Step 5: Run simulator and workbench domain tests**

Run: `pnpm test -- src/components/studio/permission-simulator.test.tsx src/domain/workbench.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/components/studio/permission-simulator.tsx src/components/studio/permission-simulator.test.tsx src/components/studio/permission-simulator.module.css src/domain/workbench.ts src/domain/workbench.test.ts
git commit -m "feat(ui): add draft-aware permission simulator"
```

---

### Task 6: Carry an editable PR title through the validated server protocol

**Files:**

- Modify: `src/domain/change.ts:1-163`
- Modify: `src/domain/change.test.ts:1-170`
- Modify: `src/domain/draft.ts:181-218`
- Modify: `src/domain/draft.test.ts`
- Modify: `app/api/changes/prepare/route.ts:1-105`
- Modify: `app/api/changes/prepare/route.test.ts`
- Modify: `src/jobs/change-job-store.ts:1-78`
- Modify: `src/jobs/change-job-service.ts:1-330`
- Modify: `src/jobs/finalize-change.test.ts`
- Modify: `src/components/change-draft.tsx`
- Modify: `src/components/change-draft.test.tsx`
- Modify: `src/github/pr-body.test.ts`
- Modify: `src/jobs/change-job-service.test.ts`
- Modify: `src/pep-webapp/apply-change.test.ts`

**Interfaces:**

- Consumes: normalized `PermissionChange` and existing `GhClient.createDraftPullRequest` title input.
- Produces: `PermissionChange.title`, `PrepareIntent.title`, `PublicChangeJob.title`, and finalization using the validated title.

- [ ] **Step 1: Write failing schema and normalization tests**

```ts
it("trims and preserves a safe PR title", () => {
  expect(
    normalizePermissionChange({ ...validChange, title: "  chore: update permissions  " }).title,
  ).toBe("chore: update permissions");
});

it.each(["short", "x".repeat(121), "bad\ntitle"])("rejects PR title %j", (title) => {
  expect(() => normalizePermissionChange({ ...validChange, title })).toThrow();
});
```

- [ ] **Step 2: Add strict title validation and draft metadata**

```ts
title: z.string()
  .trim()
  .min(8)
  .max(120)
  .refine((value) => !hasControlCharacter(value), {
    message: "title must not contain control characters",
  }),
```

Change `buildPermissionChange` metadata to `{ requestId: string; title: string; reason: string }` and include the normalized title.

Until Task 7 replaces the old form, add
`const DEFAULT_PR_TITLE = "chore(permissions): update permission catalogs"` to
`change-draft.tsx`, include it in `toIntent`, and update the existing component
expectation so the repository compiles after this task.

- [ ] **Step 3: Run domain tests**

Run: `pnpm test -- src/domain/change.test.ts src/domain/draft.test.ts`

Expected: PASS after all local fixtures include a valid title.

- [ ] **Step 4: Write failing API and finalization tests**

Assert that prepare rejects missing/control-character titles, `toPublicChangeJob` returns the title, and finalization calls:

```ts
expect(createDraftPullRequest).toHaveBeenCalledWith(
  expect.objectContaining({ title: "chore(permissions): grant report export" }),
);
```

- [ ] **Step 5: Thread title through route, job store, and finalization**

Add `title` to `prepareIntentSchema`, copy `job.change.title` in `toPublicChangeJob`, and replace the hard-coded title in `createChangeJobService` with `job.change.title`. Keep the commit message fixed and safe.

- [ ] **Step 6: Run protocol and job tests**

Run: `pnpm test -- app/api/changes/prepare/route.test.ts src/jobs/finalize-change.test.ts src/jobs/change-job-service.test.ts src/github/pr-body.test.ts`

Expected: PASS; the fake runner receives no real network command.

- [ ] **Step 7: Commit**

```powershell
git add -- src/domain/change.ts src/domain/change.test.ts src/domain/draft.ts src/domain/draft.test.ts app/api/changes/prepare/route.ts app/api/changes/prepare/route.test.ts src/jobs/change-job-store.ts src/jobs/change-job-service.ts src/jobs/finalize-change.test.ts src/jobs/change-job-service.test.ts src/github/pr-body.test.ts tests/helpers/git-fixture.ts
git commit -m "feat(changes): support validated pull request titles"
```

---

### Task 7: Business change review and extracted job flow

**Files:**

- Create: `src/components/studio/change-review.tsx`
- Create: `src/components/studio/change-review.test.tsx`
- Create: `src/components/studio/use-change-job.ts`
- Create: `src/components/studio/use-change-job.test.tsx`
- Create: `src/components/studio/pull-request-flow.tsx`
- Create: `src/components/studio/pull-request-flow.test.tsx`
- Create: `src/components/studio/pull-request-flow.module.css`
- Read source behavior from: `src/components/change-draft.tsx:1-430`

**Interfaces:**

- Consumes: `model`, `draft`, `impact`, `title`, `reason`, and existing change APIs.
- Produces:
  - `ChangeReview` with item/object/global undo callbacks.
  - `useChangeJob(intent)` with `prepare`, `confirm`, `discard`, polling, restored active job, and safe errors.
  - `PullRequestFlow` with business review, metadata, validation steps, real diff inspection, and finalization.
  - `PrepareIntent` with the exact validated payload accepted by `/api/changes/prepare`.

- [ ] **Step 1: Write failing business-review tests**

```tsx
it("groups translated business changes by role and contract", () => {
  render(<ChangeReview model={model} draft={draft} onDraftChange={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "运营" })).toBeVisible();
  expect(screen.getByText("新增权限 1 项")).toBeVisible();
  expect(screen.getByText("管理订单")).toBeVisible();
  expect(screen.getByRole("heading", { name: "ISO" })).toBeVisible();
});

it("can undo one item without discarding the object", async () => {
  const user = userEvent.setup();
  const onDraftChange = vi.fn();
  render(<ChangeReview model={model} draft={draftWithTwoItems} onDraftChange={onDraftChange} />);
  await user.click(screen.getByRole("button", { name: "撤销 管理订单" }));
  expect(onDraftChange).toHaveBeenCalledWith(draftWithOnlyOtherItem);
});
```

- [ ] **Step 2: Implement structured review from `buildImpactDiff`**

Resolve labels through the model, render additions/removals with text and icons, and delegate undo to Task 1 functions. Do not parse Git diff for this screen.

- [ ] **Step 3: Write failing hook tests for prepare, polling, restore, and recovery**

Use `renderHook`, fake timers, and mocked fetch. Cover `validating -> awaiting-confirmation`, 404 expiry cleanup, transient polling retry, finalization failure, PR creation recovery, and active-job session restoration.

- [ ] **Step 4: Extract the existing job orchestration without behavior changes**

```ts
export interface ChangeJobController {
  job: ClientChangeJob | null;
  pending: boolean;
  error: string | null;
  message: string | null;
  prepare(intent: PrepareIntent): Promise<void>;
  confirm(): Promise<void>;
  discard(): Promise<void>;
  clearCompleted(): void;
}

export interface PrepareIntent {
  baseSha: string;
  title: string;
  reason: string;
  roleChanges: Array<{ roleCode: string; add: string[]; remove: string[] }>;
  contractChanges: Array<{
    contractType: string;
    menus: { add: string[]; remove: string[] };
    widgets: { add: string[]; remove: string[] };
  }>;
}
```

Keep `permission-studio:active-change`, the 1.2-second polling interval, response error mapping, nonce confirmation, and sanitized recovery rendering.

- [ ] **Step 5: Run review and hook tests**

Run: `pnpm test -- src/components/studio/change-review.test.tsx src/components/studio/use-change-job.test.tsx`

Expected: PASS.

- [ ] **Step 6: Write failing pull-request-flow tests**

Cover title/reason validation, disabled preparation, business review, validation steps, required Git diff checkbox, final confirmation, discard, success URL, and both recovery variants.

```tsx
expect(screen.getByRole("button", { name: "校验变更" })).toBeDisabled();
await user.type(screen.getByLabelText("PR 标题"), "chore(permissions): grant report export");
await user.type(screen.getByLabelText("变更原因"), "允许运营角色导出报表数据");
expect(screen.getByRole("button", { name: "校验变更" })).toBeEnabled();
```

- [ ] **Step 7: Implement the three-stage PR flow**

Stage 1 shows `ChangeReview` and metadata. Stage 2 shows validation steps and the exact server Git diff. Stage 3 shows finalization/success/recovery. Require the existing “已检查完整 diff” checkbox before `confirm()`.

- [ ] **Step 8: Run all new flow tests**

Run: `pnpm test -- src/components/studio/change-review.test.tsx src/components/studio/use-change-job.test.tsx src/components/studio/pull-request-flow.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add -- src/components/studio/change-review.tsx src/components/studio/change-review.test.tsx src/components/studio/use-change-job.ts src/components/studio/use-change-job.test.tsx src/components/studio/pull-request-flow.tsx src/components/studio/pull-request-flow.test.tsx src/components/studio/pull-request-flow.module.css
git commit -m "feat(ui): add structured permission change review"
```

---

### Task 8: Compose the task-oriented Studio shell and migrate the page

**Files:**

- Create: `src/components/studio/change-tray.tsx`
- Create: `src/components/studio/change-tray.test.tsx`
- Create: `src/components/studio/studio-shell.tsx`
- Create: `src/components/studio/studio-shell.test.tsx`
- Create: `src/components/studio/studio-shell.module.css`
- Modify: `app/page.tsx:1-26`
- Modify: `app/globals.css`
- Delete: `src/components/permission-workbench.tsx`
- Delete: `src/components/permission-workbench.test.tsx`
- Delete: `src/components/change-draft.tsx`
- Delete: `src/components/change-draft.test.tsx`

**Interfaces:**

- Consumes: all focused components from Tasks 2–7 and the existing `/api/model` contract.
- Produces: `StudioShell({ initialModel?, loadModel? })`, the only page-level permission application component.

- [ ] **Step 1: Write failing change-tray tests**

```tsx
it("summarizes cross-object changes and opens review", async () => {
  const user = userEvent.setup();
  const onReview = vi.fn();
  render(<ChangeTray impact={impactAcrossThreeObjects} onReview={onReview} />);
  expect(screen.getByText("草稿中有 4 项变更")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "查看变更" }));
  expect(onReview).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Implement the fixed change tray**

Show total additions/removals, current-object delta, discard-all, review, and generate-PR entry. Require confirmation only for discard-all. Hide the tray for an empty draft.

- [ ] **Step 3: Write failing shell navigation, persistence, and stale replay tests**

```tsx
it("keeps one shared draft while switching task areas", async () => {
  const user = userEvent.setup();
  render(<StudioShell initialModel={model} loadModel={vi.fn()} />);
  await user.click(screen.getByRole("checkbox", { name: "管理订单" }));
  await user.click(screen.getByRole("button", { name: "添加已选权限" }));
  await user.click(screen.getByRole("tab", { name: "契约模块" }));
  await user.click(screen.getByRole("checkbox", { name: "订单" }));
  await user.click(screen.getByRole("button", { name: "移除已选模块" }));
  await user.click(screen.getByRole("tab", { name: "角色权限" }));
  expect(screen.getByText("草稿中有 2 项变更")).toBeVisible();
});

it("rebases compatible changes and shows conflicts after develop refresh", async () => {
  const user = userEvent.setup();
  render(<StudioShell initialModel={model} loadModel={vi.fn().mockResolvedValue(nextModel)} />);
  await user.click(screen.getByRole("checkbox", { name: "查看订单" }));
  await user.click(screen.getByRole("checkbox", { name: "管理订单" }));
  await user.click(screen.getByRole("button", { name: "添加已选权限" }));
  await user.click(screen.getByRole("button", { name: "刷新 develop" }));
  expect(await screen.findByText("1 项草稿冲突需要处理")).toBeVisible();
  expect(screen.getByText("orders.manage")).toBeVisible();
});
```

- [ ] **Step 4: Implement model loading, tabs, shared draft, session storage, and review routing**

```tsx
type StudioTask = "roles" | "contracts" | "simulation";

interface StudioShellProps {
  initialModel?: PermissionStudioModel | null;
  loadModel?: () => Promise<PermissionStudioModel>;
}

async function loadRemoteModel(): Promise<PermissionStudioModel> {
  const response = await fetch("/api/model", { cache: "no-store" });
  if (!response.ok) throw new Error("Permission model request failed");
  const body = (await response.json()) as { data?: unknown };
  return permissionStudioModelSchema.parse(body.data);
}

export function StudioShell({
  initialModel = null,
  loadModel = loadRemoteModel,
}: StudioShellProps) {
  const [model, setModel] = useState(initialModel);
  const [draft, setDraft] = useState(createEmptyDraft);
  const [task, setTask] = useState<StudioTask>("roles");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [conflicts, setConflicts] = useState<DraftConflict[]>([]);

  useEffect(() => {
    if (!model) return;
    const restored = restoreDraftSession(
      window.sessionStorage.getItem(draftStorageKey(model.sourceSha)),
      model.sourceSha,
    );
    if (restored) setDraft(restored.draft);
  }, [model?.sourceSha]);

  useEffect(() => {
    if (!model) return;
    window.sessionStorage.setItem(
      draftStorageKey(model.sourceSha),
      serializeDraftSession({ version: 1, sourceSha: model.sourceSha, draft }),
    );
  }, [model, draft]);

  const refresh = async () => {
    const nextModel = await loadModel();
    const rebased = model
      ? rebasePermissionDraft(model, nextModel, draft)
      : { draft: createEmptyDraft(), conflicts: [] };
    setModel(nextModel);
    setDraft(rebased.draft);
    setConflicts(rebased.conflicts);
  };
}
```

Use WAI-ARIA tab semantics for the three task areas. During a change job, lock both editors while leaving simulation and job status readable. Keep model-load retry and source-SHA status from the existing workbench.

- [ ] **Step 5: Replace the page composition and remove obsolete components**

```tsx
import { StudioShell } from "@/src/components/studio/studio-shell";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">PEP-WEBAPP · LOCAL POLICY TOOL</p>
        <h1>Permission Studio</h1>
        <p className="intro">从远程 develop 解释权限、验证变更，并在最终确认后创建 Draft PR。</p>
      </header>
      <HealthCard />
      <StudioShell />
      <footer className="target-note">
        <span>{studioConfig.targetSlug}</span>
        <span>→</span>
        <span>{studioConfig.target.baseBranch}</span>
      </footer>
    </main>
  );
}
```

Remove only obsolete workbench/change-draft CSS rules after confirming no remaining class references with `rg`.

- [ ] **Step 6: Run shell and page-adjacent tests**

Run: `pnpm test -- src/components/studio/change-tray.test.tsx src/components/studio/studio-shell.test.tsx src/components/health-card.test.tsx app/api/model/route.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the complete component test set**

Run: `pnpm test -- src/components`

Expected: PASS with no imports of deleted `PermissionWorkbench` or `ChangeDraft`.

- [ ] **Step 8: Commit**

```powershell
git add -- app/page.tsx app/globals.css src/components/studio src/components/permission-workbench.tsx src/components/permission-workbench.test.tsx src/components/change-draft.tsx src/components/change-draft.test.tsx
git commit -m "feat(ui): compose task-oriented permission studio"
```

---

### Task 9: Responsive polish, regression verification, and operator documentation

**Files:**

- Modify: `src/components/studio/dual-list-editor.module.css`
- Modify: `src/components/studio/role-permission-editor.module.css`
- Modify: `src/components/studio/contract-module-editor.module.css`
- Modify: `src/components/studio/permission-simulator.module.css`
- Modify: `src/components/studio/pull-request-flow.module.css`
- Modify: `src/components/studio/studio-shell.module.css`
- Modify: `README.md`
- Modify tests only when a real regression exposed by the checks requires a corrected assertion.

**Interfaces:**

- Consumes: the completed Studio UI and existing localhost startup workflow.
- Produces: verified desktop/narrow layouts and a reproducible manual smoke checklist without automated E2E.

- [ ] **Step 1: Add the manual acceptance checklist to README**

Document these exact checks:

```markdown
### UX smoke test

1. Open `http://127.0.0.1:3100` and verify the loaded `develop` SHA.
2. Add two permissions to one preset role with checkboxes and the transfer button.
3. Remove one permission with the pointer drag handle.
4. Switch to a second role and back; verify both draft deltas remain.
5. Enable one menu and one widget for a non-TEST contract.
6. Verify Widgets is a separate root group and no widget-to-menu relationship is implied.
7. Open simulation and verify “正在预览草稿” and changed effective evidence.
8. Open change review, undo one item, and verify totals update.
9. Resize below 760 px; verify stacked panels and button-based transfer remain usable.
10. Prepare only against mocked/local validation during development; do not confirm a real remote push.
```

- [ ] **Step 2: Run focused automated tests**

Run: `pnpm test -- src/domain src/components app/api/changes`

Expected: all focused suites PASS.

- [ ] **Step 3: Run the complete automated suite**

Run: `pnpm test`

Expected: all tests PASS and no test invokes a real GitHub write.

- [ ] **Step 4: Run static and production checks**

Run each command separately:

```powershell
pnpm typecheck
pnpm lint
pnpm exec prettier --check app src tests README.md package.json
pnpm build
```

Expected: every command exits `0`; the production build completes without hydration, CSS-module, or server/client-boundary errors.

- [ ] **Step 5: Start localhost and execute the README smoke test**

Run: `pnpm dev`

Expected: `http://127.0.0.1:3100` returns `200`. Complete all ten README checks using the current real read-only model. Do not click the final remote confirmation action.

- [ ] **Step 6: Inspect the final repository diff**

Run:

```powershell
git status --short
git diff --check
git diff --stat HEAD~8..HEAD
```

Expected: only UX redesign, dependency, protocol, tests, and README files are present; `next-env.d.ts`, `.superpowers/`, caches, and generated build output are not staged.

- [ ] **Step 7: Commit documentation or final verified polish**

```powershell
git add -- README.md src/components/studio
git commit -m "docs: add permission studio UX smoke test"
```

If Step 4 or Step 5 required a production code correction, include its exact test and implementation in this commit only after rerunning the failing command and the full verification set.

---

## Completion checkpoint

Implementation is complete only when:

- Tasks 1–9 each have their own passing focused tests and commit.
- The full Vitest suite, typecheck, lint, targeted Prettier check, and production build all pass.
- The manual desktop/narrow smoke test passes without creating a real branch or PR.
- The final UI preserves all existing source-SHA, allowlist, diff inspection, confirmation, and recovery guarantees.
- The worktree contains no staged generated files or visual-companion artifacts.
