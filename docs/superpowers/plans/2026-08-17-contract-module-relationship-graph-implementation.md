# Contract Module Relationship Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the contract module transfer list with a complete, editable mind-map-style relationship graph while preserving the existing draft, review, and pull-request workflow.

**Architecture:** A pure domain projection owns menu hierarchy, tri-state selection, search visibility, and draft mutations. A React Flow adapter renders that projection with Dagre positions and custom accessible nodes. `ContractModuleEditor` remains the contract selector and draft boundary, while `StudioShell` passes an explicit edit lock so graph viewing stays available during refresh and PR preparation.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, `@xyflow/react@12.11.3`, `@dagrejs/dagre@3.1.1`, CSS Modules, Vitest, Testing Library.

## Global Constraints

- Keep `PermissionStudioModel`, `PermissionDraft`, persisted draft sessions, change review, and PR payload formats unchanged.
- `TEST` remains unavailable in the editable contract selector.
- Permission membership changes occur only through module controls; graph edges cannot be created, reconnected, or deleted.
- Parent menu selection recursively affects every descendant, including collapsed descendants; partial descendants produce a mixed parent and complete descendants select the parent.
- Node positions and collapse state never enter the permission draft or pep-webapp changes.
- Do not modify or stage generated `next-env.d.ts` or `.superpowers/` evidence.

---

### Task 1: Pure relationship graph projection and cascade rules

**Files:**

- Create: `src/domain/contract-module-graph.ts`
- Create: `src/domain/contract-module-graph.test.ts`

**Interfaces:**

- Produces: `ContractModuleGraphNode`, `ContractModuleGraphEdge`, `ContractModuleGraphProjection`, `buildContractModuleGraph()`, and `toggleContractModuleGraphNode()`.
- Consumes: `PermissionStudioModel`, `PermissionDraft`, and existing `setContractOwnerMembership()`.

- [ ] **Step 1: Write the failing projection tests**

  Add fixtures with a root menu, two child menus, and a widget. Assert that `buildContractModuleGraph(model, draft, "ISO", { collapsed: new Set(), query: "" })` returns contract/group/menu/widget nodes and model-derived hierarchy edges. Assert selected, mixed, added, and removed state against baseline membership.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `corepack pnpm test -- src/domain/contract-module-graph.test.ts`

  Expected: FAIL because `@/src/domain/contract-module-graph` does not exist.

- [ ] **Step 3: Implement the minimal graph projection**

  Define stable IDs (`contract:<type>`, `group:menus`, `group:widgets`, `menu:<code>`, `widget:<owner>`), walk `parentMenuCode` with a visited set, derive translated labels, compare current draft membership with model baseline, and emit only nodes visible under the supplied collapsed set. A non-empty query marks matching name/code nodes and force-includes their ancestor path without mutating the collapsed set.

- [ ] **Step 4: Run projection tests and verify GREEN**

  Run: `corepack pnpm test -- src/domain/contract-module-graph.test.ts`

  Expected: all projection tests PASS.

- [ ] **Step 5: Write the failing cascade tests**

  Assert that checking a parent adds it and all descendants, unchecking removes all descendants, checking the final missing child automatically adds its ancestors, unchecking one child removes a fully selected parent while leaving it mixed, widget changes remain independent, and collapsed state has no effect on mutations.

- [ ] **Step 6: Implement `toggleContractModuleGraphNode()` and verify GREEN**

  Normalize menus deepest-first after the requested subtree mutation, call `setContractOwnerMembership()` once for the affected kind, and leave the other kind untouched.

  Run: `corepack pnpm test -- src/domain/contract-module-graph.test.ts`

  Expected: all projection and cascade tests PASS.

- [ ] **Step 7: Commit Task 1**

  ```powershell
  git add -- src/domain/contract-module-graph.ts src/domain/contract-module-graph.test.ts
  git commit -m "feat(domain): project contract module relationship graph"
  ```

### Task 2: React Flow node and deterministic Dagre layout

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `app/globals.css`
- Create: `src/components/studio/contract-module-graph-node.tsx`
- Create: `src/components/studio/contract-module-graph-node.test.tsx`
- Create: `src/components/studio/contract-module-graph.module.css`
- Create: `src/components/studio/layout-contract-module-graph.ts`
- Create: `src/components/studio/layout-contract-module-graph.test.ts`

**Interfaces:**

- Produces: `ContractModuleGraphNodeData`, `ContractModuleGraphNode`, and `layoutContractModuleGraph(projection)` returning React Flow nodes and edges.
- Consumes: Task 1 graph projection types.

- [ ] **Step 1: Install exact graph dependencies**

  Run: `corepack pnpm add @xyflow/react@12.11.3 @dagrejs/dagre@3.1.1 && corepack pnpm add -D @types/dagre@0.7.54`

  Import `@xyflow/react/dist/style.css` at the top of `app/globals.css` so Next loads the required global stylesheet once.

- [ ] **Step 2: Write failing accessible-node tests**

  Cover contract and group labels, a menu checkbox with checked/mixed/disabled semantics, collapse button labeling, added/removed badges, and widget nodes without a collapse control.

  Run: `corepack pnpm test -- src/components/studio/contract-module-graph-node.test.tsx`

  Expected: FAIL because the node component does not exist.

- [ ] **Step 3: Implement and style the custom node**

  Render native buttons and checkbox inputs, synchronize `HTMLInputElement.indeterminate`, stop pointer events from starting a drag when controls are used, expose visible text badges, and use handles only as visual edge anchors with connection disabled by the parent canvas.

- [ ] **Step 4: Write failing deterministic layout tests**

  Assert contract rank < group rank < root-menu rank < child-menu rank, sibling nodes do not overlap, stable input yields stable positions, and active/mixed target nodes yield solid emphasized edges while inactive targets yield dashed muted edges.

  Run: `corepack pnpm test -- src/components/studio/layout-contract-module-graph.test.ts`

  Expected: FAIL because the layout adapter does not exist.

- [ ] **Step 5: Implement Dagre adapter and verify GREEN**

  Use left-to-right Dagre ranks, fixed size hints by node kind, stable node/edge insertion order, `Position.Left`/`Position.Right`, and edge metadata/classes derived from projection state.

  Run: `corepack pnpm test -- src/components/studio/contract-module-graph-node.test.tsx src/components/studio/layout-contract-module-graph.test.ts`

  Expected: both files PASS.

- [ ] **Step 6: Commit Task 2**

  ```powershell
  git add -- package.json pnpm-lock.yaml app/globals.css src/components/studio/contract-module-graph-node.tsx src/components/studio/contract-module-graph-node.test.tsx src/components/studio/contract-module-graph.module.css src/components/studio/layout-contract-module-graph.ts src/components/studio/layout-contract-module-graph.test.ts
  git commit -m "feat(ui): add contract relationship graph nodes"
  ```

### Task 3: Interactive graph canvas

**Files:**

- Create: `src/components/studio/contract-module-graph.tsx`
- Create: `src/components/studio/contract-module-graph.test.tsx`
- Modify: `src/components/studio/contract-module-graph.module.css`

**Interfaces:**

- Produces: `ContractModuleGraph` with props `{ model, draft, contractType, disabled, onDraftChange }`.
- Consumes: Task 1 projection/mutation functions and Task 2 node/layout adapters.

- [ ] **Step 1: Write failing canvas rendering and mutation tests**

  Mock only the React Flow viewport shell while rendering real custom node components. Assert root/group/module rendering, no connect/reconnect/delete callbacks, a node toggle producing the expected draft, and collapse hiding descendants without producing a draft change.

  Run: `corepack pnpm test -- src/components/studio/contract-module-graph.test.tsx`

  Expected: FAIL because `ContractModuleGraph` does not exist.

- [ ] **Step 2: Implement controlled React Flow canvas and verify GREEN**

  Keep collapsed menu IDs and free-dragged positions per contract in local state. Re-run automatic layout when structural visibility changes, preserve dragged positions until “自动整理” is clicked, and configure `nodesConnectable={false}`, `edgesReconnectable={false}`, `elementsSelectable`, `panOnDrag`, `zoomOnScroll`, and `onlyRenderVisibleElements`.

- [ ] **Step 3: Write failing search and viewport tests**

  Assert name/code matching, ancestor reveal through a collapsed branch, visible match count, first-result navigation, clear-search restoration of collapse state, “适应画布”, “自动整理”, Controls, MiniMap, Background, and a textual color-independent legend.

- [ ] **Step 4: Implement search, viewport actions, toolbar, and empty states**

  Use the React Flow instance to call `fitView()` and `setCenter()` after the matched node is measured. Keep search as view-only state. Render explicit empty menu/widget nodes from the projection so an empty contract remains understandable.

- [ ] **Step 5: Add disabled-state tests and implementation**

  Assert module checkboxes and collapse/layout edit actions are disabled when `disabled`, while search, fit-view, zoom, pan, and minimap remain available. Verify disabled toggles never call `onDraftChange`.

- [ ] **Step 6: Verify Task 3 and commit**

  Run: `corepack pnpm test -- src/components/studio/contract-module-graph.test.tsx src/components/studio/contract-module-graph-node.test.tsx src/components/studio/layout-contract-module-graph.test.ts`

  Expected: all graph component tests PASS.

  ```powershell
  git add -- src/components/studio/contract-module-graph.tsx src/components/studio/contract-module-graph.test.tsx src/components/studio/contract-module-graph.module.css
  git commit -m "feat(ui): add interactive contract relationship canvas"
  ```

### Task 4: Replace the transfer editor and preserve shell locking

**Files:**

- Modify: `src/components/studio/contract-module-editor.tsx`
- Modify: `src/components/studio/contract-module-editor.test.tsx`
- Modify: `src/components/studio/contract-module-editor.module.css`
- Modify: `src/components/studio/studio-shell.tsx`
- Modify: `src/components/studio/studio-shell.test.tsx`

**Interfaces:**

- `ContractModuleEditorProps` adds `disabled?: boolean` and delegates draft changes to `ContractModuleGraph`.
- `StudioShell` passes `draftLocked` explicitly to the contract editor instead of disabling its entire view subtree.

- [ ] **Step 1: Rewrite editor tests to fail against the transfer-list implementation**

  Assert the relationship graph canvas is rendered, the available/assigned list headings and transfer action buttons are absent, changing contracts swaps graph roots, and a graph node toggle updates the draft.

  Run: `corepack pnpm test -- src/components/studio/contract-module-editor.test.tsx`

  Expected: FAIL because the editor still renders `DualListEditor`.

- [ ] **Step 2: Replace transfer-list internals with `ContractModuleGraph`**

  Remove transfer-specific selection, expansion, rendering, and membership code from `ContractModuleEditor`. Keep editable contract selection and controlled-selection synchronization. Update CSS to give the canvas a bounded responsive height and remove obsolete tree-item rules.

- [ ] **Step 3: Write and run shell lock regression tests**

  Assert that refresh or active PR state disables membership mutation but contract selection, graph search, fit-view, zoom, and pan remain usable. Assert role editor locking and simulation behavior remain unchanged.

  Run: `corepack pnpm test -- src/components/studio/studio-shell.test.tsx src/components/studio/contract-module-editor.test.tsx`

  Expected before shell change: FAIL because the disabled fieldset blocks graph viewing controls.

- [ ] **Step 4: Pass explicit contract graph lock and verify GREEN**

  Replace only the contract editor's disabled fieldset wrapper with an `aria-disabled` container and pass `disabled={draftLocked}`. Do not alter role editor locking.

  Run: `corepack pnpm test -- src/components/studio/studio-shell.test.tsx src/components/studio/contract-module-editor.test.tsx`

  Expected: both files PASS.

- [ ] **Step 5: Confirm no obsolete transfer code remains in the contract editor and commit**

  Run: `rg -n "DualListEditor|TransferRequest|reduceTreeSelection|isTreeItemIndeterminate" src/components/studio/contract-module-editor.*`

  Expected: no matches.

  ```powershell
  git add -- src/components/studio/contract-module-editor.tsx src/components/studio/contract-module-editor.test.tsx src/components/studio/contract-module-editor.module.css src/components/studio/studio-shell.tsx src/components/studio/studio-shell.test.tsx
  git commit -m "feat(ui): replace contract transfer list with relationship graph"
  ```

### Task 5: Full verification, runtime audit, and publication

**Files:**

- Modify only files needed to correct failures discovered by the checks below.

- [ ] **Step 1: Run all automated gates**

  ```powershell
  corepack pnpm test
  corepack pnpm typecheck
  corepack pnpm lint
  corepack pnpm exec prettier --check package.json pnpm-lock.yaml app/globals.css src/domain/contract-module-graph.ts src/domain/contract-module-graph.test.ts src/components/studio/contract-module-graph-node.tsx src/components/studio/contract-module-graph-node.test.tsx src/components/studio/contract-module-graph.tsx src/components/studio/contract-module-graph.test.tsx src/components/studio/contract-module-graph.module.css src/components/studio/layout-contract-module-graph.ts src/components/studio/layout-contract-module-graph.test.ts src/components/studio/contract-module-editor.tsx src/components/studio/contract-module-editor.test.tsx src/components/studio/contract-module-editor.module.css src/components/studio/studio-shell.tsx src/components/studio/studio-shell.test.tsx
  corepack pnpm build
  git diff --check
  ```

  Expected: every command exits 0.

- [ ] **Step 2: Audit the actual page at localhost**

  Start or reuse `corepack pnpm dev`, load `http://127.0.0.1:3100`, and verify the contract tab against every design acceptance criterion: graph replaces transfer list, all node kinds render, pan/zoom/drag/layout/minimap work, search locates a collapsed descendant, cascade and mixed states are visible, draft tray changes, and narrow viewport keeps the canvas usable.

- [ ] **Step 3: Inspect final scope**

  Run `git status --short`, `git diff --stat personal/feat/permission-studio-ux...HEAD`, and `git log --oneline personal/feat/permission-studio-ux..HEAD`. Confirm `next-env.d.ts` and `.superpowers/` are not staged or committed.

- [ ] **Step 4: Push the verified branch**

  Run: `git push personal feat/permission-studio-ux`

  Expected: the personal repository branch advances to the final verified commit.
