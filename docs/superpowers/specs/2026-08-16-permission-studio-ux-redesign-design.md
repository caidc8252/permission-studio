# Permission Studio UX redesign

**Date:** 2026-08-16

**Status:** Approved

**Project:** `F:\codes\permission-studio`

**Target repository:** `Newland-Payment-Technology-US-Co-Ltd/pep-webapp`

**Target branch:** `develop`

## 1. Objective

Redesign Permission Studio around its two frequent editing tasks:

1. edit the permissions owned by one preset role;
2. edit the menus and widgets enabled for one contract.

The current page combines permission simulation, effective permissions, visible modules, every editable role, every contract, and the PR workflow in one long page. The redesign separates those concerns into focused task areas, replaces large checkbox matrices with searchable dual-list editors, and adds drag and drop as a shortcut without making it the only way to edit.

The existing localhost architecture, permission model, validation jobs, temporary Git worktrees, GitHub CLI identity, and Draft PR workflow remain unchanged.

## 2. Scope

### In scope

- A task-oriented application shell with separate areas for role permissions, contract modules, and permission simulation.
- Editing one role or one contract at a time while retaining a shared cross-object draft.
- Search, category filtering, multi-selection, bulk transfer, pointer drag and drop, and keyboard-accessible transfer actions.
- A menu tree and a widget group in the contract editor.
- A persistent change tray, business-oriented change review, validation status, and final PR confirmation.
- Immediate impact calculation and simulation against the draft-applied model.
- Component and domain refactoring needed to give each UI unit one clear responsibility.
- Unit, component, and integration tests for the new interactions.

### Out of scope

- Changes to the underlying permission rules or editable configuration scope.
- Editing permission definitions, `availableWhen`, plan policies, private roles, party contract instances, member-role assignments, or the `TEST` contract.
- Remote deployment, multi-user authentication, GitHub App authentication, database storage, or automatic PR merge.
- Automated browser E2E tests. The user explicitly deferred E2E for this iteration.

## 3. Research and selected direction

The design follows the established transfer-list pattern used by [Ant Design Transfer](https://ant.design/components/transfer/) and [MUI Transfer List](https://mui.com/material-ui/react-transfer-list/): users select one or more items and move them between available and assigned lists. Permission Studio adds drag and drop as an optional shortcut.

The pointer interaction will use the core package from [Atlassian Pragmatic Drag and Drop](https://atlassian.design/components/pragmatic-drag-and-drop/core-package/). Its [accessibility guidance](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines/) informs the visible handles, non-drag alternatives, focus management, and live announcements.

Three role-editor approaches were considered:

- **Focused dual-list editor — selected.** Best balance of search, comparison, bulk editing, and direct manipulation for the current permission count.
- Card canvas — rejected. Visually direct but becomes slow to scan with more than one hundred permissions.
- Permission matrix — rejected. Dense and useful for regular CRUD permission sets, but the real permission catalog is not sufficiently uniform.

Three contract-editor approaches were considered:

- **Unified module tree — selected.** Preserves the real menu hierarchy and keeps menus and widgets in one editor.
- Separate menu and widget tabs — rejected. Hides relationships and increases context switching.
- Fixed module packages — rejected. Fast for coarse assignment but removes required fine-grained control.

The combined workspace and the business-oriented PR review flow were both visually reviewed and approved by the user.

## 4. Information architecture

The application header continues to show the fixed repository, `develop` branch, current source SHA, health status, and refresh action.

Below it, the primary navigation contains three task areas:

1. **Role permissions** — the default area and the main editing workflow.
2. **Contract modules** — menus and widgets enabled by one contract.
3. **Permission simulation / preview** — membership type, entitlements, plans, roles, effective permissions, evidence, visible menus, and visible widgets.

The role editor must not confuse membership type with a role. `MEMBER` and `ADMIN` remain simulation inputs only. The role editor lists only editable global preset roles. Private or otherwise read-only roles are either absent from the editor or clearly marked read-only when useful for context.

Switching areas, roles, or contracts does not discard the shared draft. A fixed change tray remains visible whenever the draft contains changes.

## 5. Role permission editor

### 5.1 Layout

- Left sidebar: searchable list of editable preset roles and each role's pending-change count.
- Main header: selected role name, description, assigned permission count, and draft delta.
- Toolbar: permission search, owner/module category filter, and “changes only” filter.
- Left transfer panel: permissions available to add.
- Right transfer panel: permissions currently assigned to the role.
- Center controls: add selected and remove selected buttons.

Permissions are grouped by their owner code or translated module label. Each row shows the translated name, permission code, selection control, and drag handle. Search matches the translated name, code, description, and owner.

### 5.2 Interaction

- A user can select one or more rows and move them with the center buttons.
- Dragging one selected row moves that row. Dragging a row while multiple rows are selected moves the selected set.
- Double-click is not used because it is difficult to discover and conflicts with text selection.
- Dropping into the source panel or transferring an item already present is a no-op with a short status announcement.
- Each operation produces semantic `addRolePermissions` or `removeRolePermissions` actions. Pointer, button, and keyboard paths use the same action.
- Switching roles preserves all draft changes. The sidebar indicates which roles have pending changes.

## 6. Contract module editor

### 6.1 Layout

- Left sidebar: searchable list of editable contracts and each contract's pending-change count.
- Main content: the same available/enabled dual-list interaction used by the role editor.
- Module rows live in a unified tree with two root groups:
  - **Menus**, rendered using the real `menuRegistry.parentMenuCode` hierarchy;
  - **Widgets**, rendered as a separate group.

The concept mockup showed widgets nested under menus. The exported model does not contain a widget-to-menu parent relationship, so implementation must not infer one from codes or labels. Widgets remain in their own root group until the model exposes an explicit relationship.

### 6.2 Interaction

- Menu branches can be expanded or collapsed without changing the draft.
- Selecting a menu branch can select its visible descendants for an explicit bulk transfer; the pending selection count makes this scope clear before moving.
- The transfer operation changes only the codes explicitly selected by the user. It does not invent parent or widget changes that are not represented by the model.
- Widgets can be transferred individually or in a selected batch.
- `TEST` remains read-only and is not offered as an editable contract.

## 7. Permission simulation

Simulation moves out of the edit page into its own task area. It retains the current inputs and permission-decision evidence, with clearer labels:

- membership type: `MEMBER` or `ADMIN`;
- contract entitlements and plans;
- selected roles;
- effective, role-blocked, contract-blocked, and plan-blocked permissions;
- visible menu tree and widgets.

Simulation runs against `applyDraftToModel(model, draft)`, not only the original loaded model. The user therefore sees the expected result of pending edits before creating a PR. A clear “previewing draft” indicator distinguishes this state from the loaded `develop` baseline.

## 8. Shared draft and change tray

`PermissionDraft` remains the canonical client representation. It is owned by the top-level studio container rather than an individual editor.

The fixed change tray shows:

- total additions and removals;
- the currently selected object's delta;
- actions to discard all changes, review changes, and begin PR preparation.

The draft is retained during navigation and is stored in `sessionStorage` under a key containing `sourceSha`. Reloading the same SHA can restore it. A draft for another SHA is never silently applied as current.

The tray's PR action stays disabled when there are no changes, the reason is invalid, the source is stale, or a validation/finalization job is active.

## 9. Change review and PR flow

The existing two-phase remote-write flow remains authoritative:

1. Review structured business changes grouped by role and contract.
2. Enter or edit the PR title and reason.
3. Prepare the change through the existing API.
4. Apply changes in a temporary worktree, validate them, and generate the real source diff.
5. Show validation steps and the full Git diff.
6. Require explicit final confirmation.
7. Push a `permission-studio/*` branch and create a Draft PR targeting `develop`.

The first review screen favors business names and codes over a raw source diff. It supports undoing one item or all changes for one object. The final confirmation still requires inspection of the generated source diff before any remote write.

The PR panel shows the exact source branch, target branch, planned file count, validation state, and operations that will occur. It states that no `pep-webapp` remote write happens before confirmation.

## 10. Component boundaries

The current `PermissionWorkbench` and `ChangeDraft` responsibilities will be split into focused units:

- `StudioShell`: model loading, refresh, navigation, source status, and top-level draft ownership.
- `RolePermissionEditor`: selected role and role-specific projections.
- `ContractModuleEditor`: selected contract and module-tree projections.
- `PermissionSimulator`: simulation inputs and calculated results.
- `DualListEditor<T>`: search results, selection, transfer controls, drop zones, focus restoration, and announcements. It has no permission-domain knowledge.
- `ModuleTree`: menu hierarchy and widget root-group rendering.
- `ChangeTray`: compact global draft summary and entry to review.
- `ChangeReview`: structured impact review and per-item/per-object undo.
- `PullRequestFlow`: preparation polling, validation results, source diff confirmation, finalization, and recovery.
- `usePermissionDraft` or an equivalent reducer-backed controller: semantic draft actions, session restoration, impact calculation, and stale-draft handling.

Pure projections and mutations stay in `src/domain`. React components receive already prepared view data and emit semantic actions, so drag-and-drop mechanics cannot bypass domain validation.

## 11. Data flow

```text
load develop model
  -> StudioShell owns model + sourceSha + PermissionDraft
  -> editor emits semantic add/remove/batch action
  -> draft reducer validates and updates PermissionDraft
  -> buildImpactDiff updates ChangeTray and ChangeReview
  -> applyDraftToModel feeds PermissionSimulator
  -> user starts review
  -> existing prepare API validates SHA and source changes
  -> user inspects validation result + real Git diff
  -> existing confirm API pushes branch and creates Draft PR
```

The draft reducer provides set-based batch operations in addition to the current single-item toggles. Operations are deterministic, deduplicated, and sorted before conversion to `PermissionChange`.

## 12. Stale data and failure handling

- **Invalid or duplicate transfer:** no state change; announce why.
- **Model load failure:** keep the focused retry state and do not show an empty editor as valid data.
- **Remote SHA changed:** mark the draft stale and disable preparation. Refresh the model, reapply semantic changes whose role, contract, and codes still exist, and list unresolved items as conflicts. Never guess replacements for renamed or removed codes.
- **Unsupported AST shape:** fail closed before remote writes and expose the existing sanitized failure summary.
- **Validation failure:** show the failing step and sanitized logs; do not push a branch.
- **Push failure:** do not attempt PR creation; preserve the existing recovery information.
- **Push success and PR creation failure:** preserve the remote branch and show the exact manual recovery command.
- **Active job:** lock editing while validation or finalization owns the prepared change. Existing session-based job recovery remains in use.

Errors appear close to the action that failed, while job-level failures stay in the PR flow. Color is never the sole status indicator.

## 13. Accessibility and responsive behavior

- Every transfer row has a normal checkbox and every panel has add/remove buttons.
- Drag begins only from a visible handle with grab/grabbing cursor feedback.
- Pointer dragging is an enhancement; all changes are possible without it.
- After a transfer, focus moves to the transferred row in the destination or to the next logical source row.
- An `aria-live` region announces item count, destination, no-op drops, and validation state.
- Tree expansion, selection, and transfer are separate keyboard actions.
- The desktop layout shows both panels simultaneously. On narrow screens, the panels stack vertically with the same explicit add/remove actions; pointer drag is not required across long scroll distances.
- Labels, icons, and text accompany status colors.

## 14. Testing strategy

### Domain tests

- Single and batch role-permission additions/removals.
- Single and batch menu/widget additions/removals.
- Deterministic deduplication and sorting.
- Draft projection into simulation.
- Per-item, per-object, and global undo.
- Draft restoration for the same SHA and conflict detection for a new SHA.
- Menu-tree selection behavior without inventing widget relationships.

### Component tests

- Role and contract selection while retaining draft changes.
- Search, filters, multi-selection, bulk buttons, and changes-only view.
- Pointer drop callbacks and the equivalent button/keyboard results.
- Focus restoration and live-region announcements.
- Change tray totals and review navigation.
- Business-diff review, undo actions, validation state, final confirmation, and recovery states.
- Clear distinction between membership type and editable roles.

### Existing integration checks

- API route and job-state tests.
- Permission calculation and model validation tests.
- AST source editor tests.
- Git cache/worktree lifecycle tests.
- GitHub CLI adapter tests.
- TypeScript, ESLint, Prettier, production build, and the complete Vitest suite.

No test or build command may create a real remote branch or PR. Automated browser E2E remains excluded; completion includes a manual localhost smoke test for pointer drag, keyboard transfer, desktop layout, narrow layout, change review, and job-state rendering.

## 15. Acceptance criteria

1. Role permissions and contract modules are independent primary task areas.
2. A user edits one role or one contract at a time without losing cross-object draft changes.
3. Both editors support search, multi-select, buttons, keyboard use, and pointer drag and drop.
4. The role editor no longer renders every role-by-permission checkbox at once.
5. The contract editor renders the real menu hierarchy and a separate widget group without fabricating relationships.
6. Simulation uses the draft-applied model and clearly labels the preview state.
7. The change tray accurately summarizes additions and removals across all edited objects.
8. Review shows business changes before the generated Git diff, while final remote confirmation still requires the real diff.
9. A stale base SHA cannot be submitted; compatible semantic changes can be replayed and conflicts are explicit.
10. Drag and drop is never required to complete an edit.
11. Existing validation, Git safety, and Draft PR guarantees remain intact.
12. All non-E2E automated checks pass, followed by the documented manual browser smoke test.
