# Standalone Local-GH Permission Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (<code>- [ ]</code>) syntax for tracking.

**Goal:** Build a standalone localhost Permission Studio that fetches <code>pep-webapp/develop</code>, explains effective permissions, safely edits the supported catalogs, validates the resulting source, and opens a Draft PR through the current local <code>gh</code> identity.

**Architecture:** A standalone Next.js application owns the UI, permission domain, Git repository cache, AST editor, validation jobs, and GitHub CLI adapter. It maintains an isolated bare cache and per-request worktrees under LocalAppData, binds every draft to an exact remote SHA, performs no remote write before final confirmation, and never handles a GitHub token directly.

**Tech Stack:** Node.js 24, pnpm 10, TypeScript 5, Next.js 16, React 19, Zod 4, Babel parser, Vitest 4, Testing Library, native child_process, Git, and GitHub CLI.

## Global Constraints

- Repository root is <code>F:\codes\permission-studio</code>; it must not become a workspace package of <code>pep-webapp</code>.
- Target repository is fixed to <code>Newland-Payment-Technology-US-Co-Ltd/pep-webapp</code>.
- Target base branch is fixed to <code>develop</code>.
- Local server binds to <code>127.0.0.1:3100</code>.
- Authentication is the current <code>gh auth login</code> identity; the application does not read, store, log, or return its token.
- No browser OAuth, GitHub App, PAT management, database, webhook, remote deployment, Playwright, or browser E2E in version 1.
- The application never reads an existing user checkout of <code>pep-webapp</code>.
- Every draft is bound to an exact <code>origin/develop</code> SHA and fails closed when that SHA becomes stale.
- Remote branches use the <code>permission-studio/</code> prefix, target <code>develop</code>, are never force-pushed, and only produce Draft PRs.
- Version 1 edits only GLOBAL preset-role permissions and real-contract menu/widget bindings. It never edits permission codes, availability, plan policies, PRIVATE roles, party instances, member assignments, <code>TEST</code>, workflows, dependencies, or unrelated application source.
- Command execution uses executable-plus-argument arrays with <code>shell: false</code>; user-controlled values never become executable names, paths outside owned roots, or shell fragments.
- All behavior is developed red-green-refactor and every task ends in an independently reviewable commit.

---

## File Structure

- <code>app/</code>: Next.js shell, health endpoint, model endpoint, prepare/finalize endpoints.
- <code>src/domain/model.ts</code>: serializable Permission Studio model and strict boundary schema.
- <code>src/domain/effective-permissions.ts</code>: pure contract/plan/role evaluator.
- <code>src/domain/change.ts</code>: versioned change request, normalization, and conflict guards.
- <code>src/domain/draft.ts</code>: immutable edit projection and impact diff.
- <code>src/system/config.ts</code>: immutable target and local-storage configuration.
- <code>src/system/command-runner.ts</code>: bounded subprocess abstraction with redaction and cancellation.
- <code>src/github/gh-client.ts</code>: login, viewer, repository access, push identity, and Draft PR operations.
- <code>src/git/repository-cache.ts</code>: bare cache, fetch, exact SHA, worktree creation, and safe cleanup.
- <code>src/pep-webapp/export-model.mjs</code>: target-side dynamic import bridge for the authoritative CoC declarations.
- <code>src/pep-webapp/model-loader.ts</code>: creates model worktrees, installs locked dependencies, and validates exported JSON.
- <code>src/pep-webapp/source-editor.mjs</code>: comment-preserving AST range edits.
- <code>src/jobs/change-job-service.ts</code>: prepare/finalize state machine and single-writer lock.
- <code>src/jobs/validation.ts</code>: target generator, formatting, focused tests, and typecheck.
- <code>src/components/permission-workbench.tsx</code>: simulation and effective-permission view.
- <code>src/components/change-draft.tsx</code>: supported editing, diff, prepare, confirm, and PR result.
- <code>tests/fixtures/pep-webapp/</code>: compact CoC and Git fixtures.
- <code>README.md</code>: prerequisites, localhost workflow, cache lifecycle, recovery, and manual acceptance.

---

### Task 1: Standalone project foundation and bounded command runner

**Files:**
- Create: <code>package.json</code>
- Create: <code>pnpm-lock.yaml</code>
- Create: <code>tsconfig.json</code>
- Create: <code>next.config.ts</code>
- Create: <code>next-env.d.ts</code>
- Create: <code>vitest.config.ts</code>
- Create: <code>eslint.config.mjs</code>
- Create: <code>.prettierrc.json</code>
- Create: <code>.gitignore</code>
- Create: <code>app/layout.tsx</code>
- Create: <code>app/page.tsx</code>
- Create: <code>app/globals.css</code>
- Create: <code>src/system/config.ts</code>
- Create: <code>src/system/command-runner.ts</code>
- Test: <code>src/system/config.test.ts</code>
- Test: <code>src/system/command-runner.test.ts</code>

**Interfaces:**
- Produces: <code>studioConfig</code>, <code>CommandSpec</code>, <code>CommandResult</code>, <code>CommandRunner</code>, and <code>createCommandRunner()</code>.

- [ ] **Step 1: Scaffold package metadata and test configuration**

Use exact runtime scripts and dependencies:

~~~json
{
  "name": "permission-studio",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24", "pnpm": ">=10" },
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1 --port 3100",
    "build": "next build",
    "start": "next start --hostname 127.0.0.1 --port 3100",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format:check": "prettier --check ."
  }
}
~~~

Install Next 16, React 19, Zod 4, Babel parser, TypeScript 5, Vitest 4, jsdom, Testing Library, ESLint, and Prettier with <code>corepack pnpm install</code>.

- [ ] **Step 2: Write failing configuration and runner tests**

~~~ts
expect(studioConfig.target).toEqual({
  owner: "Newland-Payment-Technology-US-Co-Ltd",
  repo: "pep-webapp",
  baseBranch: "develop",
  branchPrefix: "permission-studio/",
});
expect(studioConfig.cacheRoot.startsWith(process.env.LOCALAPPDATA!)).toBe(true);
expect(studioConfig.cacheRepoPath).toBe(
  join(studioConfig.cacheRoot, "cache", "pep-webapp.git"),
);
expect(studioConfig.worktreeRoot).toBe(join(studioConfig.cacheRoot, "worktrees"));
expect(studioConfig.logRoot).toBe(join(studioConfig.cacheRoot, "logs"));

const result = await runner.run({
  executable: process.execPath,
  args: ["-e", "process.stdout.write('ok')"],
  timeoutMs: 5_000,
});
expect(result).toMatchObject({ exitCode: 0, stdout: "ok" });
~~~

- [ ] **Step 3: Run tests and verify RED**

Run: <code>corepack pnpm vitest run src/system/config.test.ts src/system/command-runner.test.ts</code>

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement immutable configuration and command execution**

~~~ts
export interface CommandSpec {
  executable: string;
  args: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}
~~~

The runner must set <code>shell: false</code>, cap stdout/stderr independently, kill timed-out children, omit inherited token-like variables from error serialization, and throw a typed <code>CommandExecutionError</code> for non-zero exits.

- [ ] **Step 5: Add the minimal Next.js shell**

Render the product name, localhost-only notice, and a server-rendered static health card. Do not add repository behavior yet.

- [ ] **Step 6: Verify and commit**

Run:

~~~text
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
~~~

Expected: PASS.

Commit: <code>feat: scaffold standalone permission studio</code>

---

### Task 2: Effective-permission domain engine

**Files:**
- Create: <code>src/domain/model.ts</code>
- Create: <code>src/domain/effective-permissions.ts</code>
- Test: <code>src/domain/effective-permissions.test.ts</code>

**Interfaces:**
- Consumes: <code>ContractEntitlement</code>, role inputs, contract scopes, and plan policies.
- Produces: <code>explainEffectivePermissions(input): EffectivePermissionResult</code>.

- [ ] **Step 1: Write failing contract, role, plan, and ADMIN vectors**

~~~ts
const member = explainEffectivePermissions({
  permissionCodes: ["orders.view", "orders.manage"],
  contractScope: { ISO: ["orders.view", "orders.manage"] },
  contractPlanPolicies: {
    ISO: {
      plans: ["STANDARD", "ENTERPRISE"],
      permissionPlans: { "orders.manage": ["ENTERPRISE"] },
    },
  },
  entitlements: [{ contractType: "ISO", plan: "STANDARD" }],
  roles: [{ code: "preset_ops", permissionCodes: ["orders.view", "orders.manage"] }],
  selectedRoleCodes: ["preset_ops"],
  membershipType: "MEMBER",
});
expect(member.effectiveCodes).toEqual(["orders.view"]);
expect(member.decisions["orders.manage"]).toMatchObject({
  roleGranted: true,
  contractGranted: false,
  blockedByPlan: true,
});
~~~

Add multi-contract, unknown-plan, empty-role, duplicate-input, immutability, and ADMIN cases. ADMIN must bypass roles but remain constrained by contract and plan scope.

- [ ] **Step 2: Run and verify RED**

Run: <code>corepack pnpm vitest run src/domain/effective-permissions.test.ts</code>

Expected: FAIL because the evaluator does not exist.

- [ ] **Step 3: Implement deterministic explanations**

~~~ts
export function explainEffectivePermissions(
  input: EffectivePermissionInput,
): EffectivePermissionResult;
~~~

Produce one decision per known permission with sorted <code>grantingContracts</code>, <code>grantingRoles</code>, <code>roleGranted</code>, <code>contractGranted</code>, <code>blockedByPlan</code>, <code>bypassedByAdminMembership</code>, and <code>effective</code>. Never mutate inputs.

- [ ] **Step 4: Verify and commit**

Run: <code>corepack pnpm vitest run src/domain/effective-permissions.test.ts</code>

Expected: PASS.

Commit: <code>feat(domain): explain effective permissions</code>

---

### Task 3: Strict model, change protocol, and immutable drafts

**Files:**
- Modify: <code>src/domain/model.ts</code>
- Create: <code>src/domain/change.ts</code>
- Create: <code>src/domain/draft.ts</code>
- Test: <code>src/domain/model.test.ts</code>
- Test: <code>src/domain/change.test.ts</code>
- Test: <code>src/domain/draft.test.ts</code>

**Interfaces:**
- Produces: <code>permissionStudioModelSchema</code>, <code>permissionChangeSchema</code>, <code>normalizePermissionChange()</code>, <code>createEmptyDraft()</code>, <code>toggleRolePermission()</code>, <code>toggleContractOwner()</code>, <code>applyDraftToModel()</code>, and <code>buildImpactDiff()</code>.

- [ ] **Step 1: Write failing strict-boundary tests**

~~~ts
expect(() => permissionStudioModelSchema.parse(validModel)).not.toThrow();
expect(() => permissionStudioModelSchema.parse({ ...validModel, sourceSha: "short" })).toThrow();
expect(() => permissionStudioModelSchema.parse({ ...validModel, unknown: true })).toThrow();

expect(() =>
  normalizePermissionChange({
    ...validChange,
    roleChanges: [{ roleCode: "preset_ops", add: ["orders.view"], remove: ["orders.view"] }],
  }),
).toThrow(/both add and remove/);
~~~

Assert a 40-character lowercase SHA, ULID request ID, reason length 8-500, bounded arrays, no control characters, no empty final change, no <code>TEST</code> edit, preset role prefix, normalization sorting, and deduplication.

- [ ] **Step 2: Write failing immutable draft tests**

~~~ts
const next = toggleRolePermission(createEmptyDraft(), model, "preset_ops", "orders.view");
expect(model.roles[0].permissionCodes).toEqual(original);
expect(buildImpactDiff(model, next).addedRolePermissions).toEqual([
  { roleCode: "preset_ops", code: "orders.view" },
]);
~~~

- [ ] **Step 3: Run and verify RED**

Run: <code>corepack pnpm vitest run src/domain/model.test.ts src/domain/change.test.ts src/domain/draft.test.ts</code>

Expected: FAIL because the schemas and draft helpers do not exist.

- [ ] **Step 4: Implement strict schemas and draft projections**

The model contains registries, availability, contract types, contract menus/widgets, plan policies, roles, translations, and <code>sourceSha</code>. Parsing must use strict Zod objects and maximum sizes before the model crosses the server-to-client boundary.

- [ ] **Step 5: Verify and commit**

Run: <code>corepack pnpm vitest run src/domain</code>

Expected: PASS.

Commit: <code>feat(domain): define permission changes and drafts</code>

---

### Task 4: Local GitHub CLI preflight

**Files:**
- Create: <code>src/github/gh-client.ts</code>
- Create: <code>src/github/gh-client.test.ts</code>
- Create: <code>app/api/health/route.ts</code>
- Modify: <code>app/page.tsx</code>

**Interfaces:**
- Consumes: <code>CommandRunner</code> and <code>studioConfig.target</code>.
- Produces: <code>GhClient</code>, <code>GhPreflight</code>, <code>createGhClient()</code>, and <code>GET /api/health</code>.

- [ ] **Step 1: Write failing adapter tests with a fake runner**

~~~ts
const preflight = await client.preflight();
expect(fake.calls).toEqual([
  ["gh", ["auth", "status", "--hostname", "github.com"]],
  ["gh", ["api", "user"]],
  [
    "gh",
    [
      "repo",
      "view",
      "Newland-Payment-Technology-US-Co-Ltd/pep-webapp",
      "--json",
      "nameWithOwner,isPrivate,viewerPermission",
    ],
  ],
]);
expect(preflight).toMatchObject({ login: "caidc8252", canWrite: true });
~~~

Cover missing executable, unauthenticated user, inaccessible repository, read-only permission, malformed JSON, timeout, and stderr redaction.

- [ ] **Step 2: Run and verify RED**

Run: <code>corepack pnpm vitest run src/github/gh-client.test.ts</code>

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement preflight without reading a token**

Use <code>gh api user</code> for the login/id and <code>gh repo view</code> for access. Never invoke <code>gh auth token</code>. Map <code>WRITE</code>, <code>MAINTAIN</code>, and <code>ADMIN</code> to <code>canWrite: true</code>.

~~~ts
export interface GhViewer {
  login: string;
  id: number;
  noreplyEmail: string;
}
~~~

- [ ] **Step 4: Expose health and render actionable setup**

The endpoint returns executable availability, authentication, login, repository access, and cache readiness only. It must never include process environment, command lines containing credentials, or raw credential-helper output.

- [ ] **Step 5: Verify and commit**

Run:

~~~text
corepack pnpm vitest run src/github/gh-client.test.ts
corepack pnpm typecheck
corepack pnpm build
~~~

Expected: PASS.

Commit: <code>feat(github): check local gh access</code>

---

### Task 5: Isolated target repository cache and worktrees

**Files:**
- Create: <code>src/git/repository-cache.ts</code>
- Test: <code>src/git/repository-cache.test.ts</code>
- Create: <code>tests/helpers/git-fixture.ts</code>

**Interfaces:**
- Consumes: <code>CommandRunner</code> and <code>studioConfig</code>.
- Produces: <code>RepositoryCache</code>, <code>refresh(): Promise&lt;RemoteRevision&gt;</code>, <code>createWorktree(requestId, sha)</code>, and <code>removeWorktree(handle)</code>.

- [ ] **Step 1: Write failing tests against a temporary local bare remote**

~~~ts
const revision = await cache.refresh();
expect(revision.sha).toMatch(/^[0-9a-f]{40}$/);
expect(revision.ref).toBe("refs/remotes/origin/develop");

const worktree = await cache.createWorktree(requestId, revision.sha);
expect(await readFile(join(worktree.path, "fixture.txt"), "utf8")).toBe("develop\n");
await cache.removeWorktree(worktree);
expect(existsSync(worktree.path)).toBe(false);
~~~

Cover first clone, repeated fetch, concurrent refresh serialization, invalid request IDs, non-owned cleanup paths, stale handles, and failure cleanup.

- [ ] **Step 2: Run and verify RED**

Run: <code>corepack pnpm vitest run src/git/repository-cache.test.ts</code>

Expected: FAIL because the cache does not exist.

- [ ] **Step 3: Implement the cache**

For production, clone with:

~~~ts
await runner.run({
  executable: "gh",
  args: [
    "repo",
    "clone",
    "Newland-Payment-Technology-US-Co-Ltd/pep-webapp",
    studioConfig.cacheRepoPath,
    "--",
    "--bare",
  ],
  timeoutMs: 120_000,
});
await runner.run({
  executable: "git",
  args: [
    "-C",
    studioConfig.cacheRepoPath,
    "fetch",
    "--prune",
    "origin",
    "+refs/heads/develop:refs/remotes/origin/develop",
  ],
  timeoutMs: 120_000,
});
await runner.run({
  executable: "git",
  args: [
    "-C",
    studioConfig.cacheRepoPath,
    "worktree",
    "add",
    "--detach",
    worktreePath,
    revision.sha,
  ],
  timeoutMs: 120_000,
});
~~~

The test fixture injects a local remote URL. Resolve and verify all paths before recursive cleanup. Do not use <code>git reset --hard</code> in a user checkout.

- [ ] **Step 4: Verify and commit**

Run: <code>corepack pnpm vitest run src/git/repository-cache.test.ts</code>

Expected: PASS.

Commit: <code>feat(git): manage isolated pep-webapp worktrees</code>

---

### Task 6: Authoritative remote permission-model extraction

**Files:**
- Create: <code>src/pep-webapp/build-model.ts</code>
- Create: <code>src/pep-webapp/export-model.mjs</code>
- Create: <code>src/pep-webapp/model-loader.ts</code>
- Test: <code>src/pep-webapp/build-model.test.ts</code>
- Test: <code>src/pep-webapp/model-loader.test.ts</code>
- Create: <code>tests/fixtures/pep-webapp/model/</code>
- Create: <code>app/api/model/route.ts</code>
- Create: <code>scripts/smoke-model.ts</code>

**Interfaces:**
- Consumes: exact target SHA and a detached repository worktree.
- Produces: <code>buildPermissionStudioModel(input)</code>, <code>loadRemotePermissionModel()</code>, and <code>GET /api/model</code>.

- [ ] **Step 1: Write failing pure model-builder tests**

~~~ts
const model = buildPermissionStudioModel({
  sourceSha,
  registry,
  contractTypes,
  contractMenus,
  contractWidgets,
  contractPlanPolicies,
  permissionAvailabilityBypassContracts: ["TEST"],
  roles,
  translations,
});
expect(model.permissionCodes).toEqual(["orders.manage", "orders.view"]);
expect(model.contractScope.ISO).toEqual(["orders.manage", "orders.view"]);
~~~

Cover deterministic sorting, availability narrowing, TEST bypass, widget-owned permissions, translation flattening, and invalid catalog references.

- [ ] **Step 2: Write failing loader orchestration tests**

Use fake cache and runner instances. Assert the loader creates a detached worktree, performs <code>corepack pnpm install --frozen-lockfile</code> only when the lockfile cache key changes, invokes the exporter with an absolute target root, validates JSON, and always removes the worktree.

- [ ] **Step 3: Run and verify RED**

Run: <code>corepack pnpm vitest run src/pep-webapp/build-model.test.ts src/pep-webapp/model-loader.test.ts</code>

Expected: FAIL because the model extractor does not exist.

- [ ] **Step 4: Implement the target bridge**

The bridge dynamically imports, from the checked-out target root:

~~~text
apps/web/manifest/collect.ts
packages/platform-config/src/coc/index.ts
packages/platform-config/src/role-id.ts
~~~

It calls the target repository's own <code>buildRegistry</code>, <code>validateCatalog</code>, <code>validatePermissionAvailability</code>, <code>deriveContractScope</code>, <code>validateContractPlanPolicies</code>, and role validators. It loads module/catalog translations for <code>en</code>, <code>zh-CN</code>, and <code>ja</code>. Any error diagnostic rejects the model.

- [ ] **Step 5: Implement strict API behavior**

The API returns the validated model plus refresh time. An unauthenticated/inaccessible GitHub state returns a stable error code. It must not expose cache/worktree paths.

- [ ] **Step 6: Verify with fixtures and a real read-only smoke check**

Run:

~~~text
corepack pnpm vitest run src/pep-webapp
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec tsx scripts/smoke-model.ts
~~~

Expected: unit tests, typecheck, and build PASS; smoke command reads <code>origin/develop</code>, prints counts and SHA, and performs no remote write.

Commit: <code>feat(model): load permissions from remote develop</code>

---

### Task 7: Read-only permission workbench

**Files:**
- Create: <code>src/domain/workbench.ts</code>
- Test: <code>src/domain/workbench.test.ts</code>
- Create: <code>src/components/permission-workbench.tsx</code>
- Test: <code>src/components/permission-workbench.test.tsx</code>
- Modify: <code>app/page.tsx</code>
- Modify: <code>app/globals.css</code>

**Interfaces:**
- Consumes: validated <code>PermissionStudioModel</code>.
- Produces: <code>buildWorkbenchView()</code> and a three-column responsive workbench.

- [ ] **Step 1: Write failing projection tests**

~~~ts
const view = buildWorkbenchView(model, {
  membershipType: "MEMBER",
  entitlements: [{ contractType: "US-ISO", plan: "STANDARD" }],
  roleCodes: ["preset_iso_ops"],
});
expect(view.permissions.some((item) => item.status === "plan-blocked")).toBe(true);
expect(view.visibleMenus.map((item) => item.menuCode)).toContain("orders");
~~~

- [ ] **Step 2: Write failing component tests**

Assert semantic fieldsets, contract/plan/role controls, textual permission states, permission search, menu tree, source SHA, refresh action, keyboard-visible controls, and the no-model health state.

- [ ] **Step 3: Run and verify RED**

Run: <code>corepack pnpm vitest run src/domain/workbench.test.ts src/components/permission-workbench.test.tsx</code>

Expected: FAIL because the projection and component do not exist.

- [ ] **Step 4: Implement the immutable projection and UI**

Localize from <code>zh-CN</code> with code fallback. Keep simulation state client-side; refreshing replaces the complete model and clears stale selection values that no longer exist.

- [ ] **Step 5: Verify and commit**

Run:

~~~text
corepack pnpm vitest run src/domain/workbench.test.ts src/components/permission-workbench.test.tsx
corepack pnpm typecheck
corepack pnpm build
~~~

Expected: PASS.

Commit: <code>feat(ui): add permission workbench</code>

---

### Task 8: Supported editing and impact diff

**Files:**
- Create: <code>src/components/change-draft.tsx</code>
- Test: <code>src/components/change-draft.test.tsx</code>
- Modify: <code>src/components/permission-workbench.tsx</code>

**Interfaces:**
- Consumes: domain draft helpers and <code>PermissionChange</code>.
- Produces: editable role/contract controls that emit a normalized prepare intent through an injected <code>onPrepare</code> callback.

- [ ] **Step 1: Write failing editor tests**

~~~ts
await user.click(screen.getByLabelText("角色 preset_iso_ops 的 orders.view"));
expect(screen.getByText("角色授权 +1 / -0")).toBeVisible();
expect(screen.getByRole("button", { name: "验证变更" })).toBeDisabled();
await user.type(screen.getByLabelText("变更原因"), "为运营角色增加订单查看能力");
expect(screen.getByRole("button", { name: "验证变更" })).toBeEnabled();
~~~

Assert TEST is absent, non-preset roles are absent, undo restores the baseline, stale models disable prepare, and impact counts cover roles, menus, widgets, and affected scenarios.

- [ ] **Step 2: Run and verify RED**

Run: <code>corepack pnpm vitest run src/components/change-draft.test.tsx</code>

Expected: FAIL because the editor does not exist.

- [ ] **Step 3: Implement editing**

The component emits intent without a request ID. It normalizes display order for a stable preview, but treats the server as the eventual authority. It exposes <code>onPrepare(intent)</code>, pending state, and stable client-side error rendering without importing any server module.

- [ ] **Step 4: Verify and commit**

Run: <code>corepack pnpm vitest run src/domain src/components</code>

Expected: PASS.

Commit: <code>feat(ui): prepare permission change drafts</code>

---

### Task 9: Comment-preserving pep-webapp AST editor

**Files:**
- Create: <code>src/pep-webapp/source-editor.mjs</code>
- Create: <code>src/pep-webapp/apply-change.mjs</code>
- Test: <code>src/pep-webapp/source-editor.test.ts</code>
- Test: <code>src/pep-webapp/apply-change.test.ts</code>
- Create: <code>tests/fixtures/pep-webapp/source-editor/</code>

**Interfaces:**
- Consumes: normalized <code>PermissionChange</code> and detached target worktree.
- Produces: <code>planSourceEdits()</code>, <code>applySourceEdits()</code>, and <code>applyPermissionChange()</code>.

- [ ] **Step 1: Write failing AST fixture tests**

Cover:

- inline and multiline arrays;
- LF and CRLF;
- comments and untouched element order;
- trailing commas;
- add/remove role permissions;
- add/remove contract menus and widgets;
- inherited <code>...COMMON_WIDGETS</code> removal by expanding only the selected contract;
- sibling contracts remaining unchanged;
- unknown/computed/dynamic shapes failing closed;
- atomicity when the second requested edit is unsupported;
- idempotent second application.

~~~ts
const plan = planSourceEdits(source, {
  owner: "GLOBAL_ROLES",
  key: "preset_ops",
  field: "permissionCodes",
  add: ["orders.view"],
  remove: [],
});
expect(applySourceEdits(source, plan)).toContain('"orders.view"');
expect(source).toContain("// preserved");
~~~

- [ ] **Step 2: Run and verify RED**

Run: <code>corepack pnpm vitest run src/pep-webapp/source-editor.test.ts src/pep-webapp/apply-change.test.ts</code>

Expected: FAIL because the editor does not exist.

- [ ] **Step 3: Implement plan-before-write AST edits**

Parse with Babel TypeScript support. Discover exact initializer ranges, calculate every edit before writing any file, reject overlapping edits, preserve newline style and indentation, then write through temporary sibling files followed by atomic replacement.

- [ ] **Step 4: Verify and commit**

Run: <code>corepack pnpm vitest run src/pep-webapp/source-editor.test.ts src/pep-webapp/apply-change.test.ts</code>

Expected: PASS.

Commit: <code>feat(pep): apply permission catalogs safely</code>

---

### Task 10: Prepare-time validation and final diff

**Files:**
- Create: <code>src/jobs/validation.ts</code>
- Create: <code>src/jobs/change-job-store.ts</code>
- Create: <code>src/jobs/change-job-service.ts</code>
- Test: <code>src/jobs/validation.test.ts</code>
- Test: <code>src/jobs/change-job-service.test.ts</code>
- Create: <code>app/api/changes/prepare/route.ts</code>
- Test: <code>app/api/changes/prepare/route.test.ts</code>
- Create: <code>app/api/changes/[id]/route.ts</code>

**Interfaces:**
- Consumes: repository cache, model loader, source editor, command runner, and normalized change.
- Produces: <code>prepareChange()</code>, <code>getChangeJob()</code>, <code>discardPreparedChange()</code>, and a prepared result containing exact diff and validation steps.

- [ ] **Step 1: Write failing validation command tests**

Assert this ordered target sequence:

~~~text
corepack pnpm install --frozen-lockfile
corepack pnpm gen:coc
corepack pnpm prettier --write apps/web/manifest/catalog/roles.ts apps/web/manifest/catalog/contract-types.ts
corepack pnpm vitest run apps/web/manifest/catalog/roles.test.ts apps/web/manifest/catalog/contract-types.test.ts
corepack pnpm typecheck
git diff --check
git diff --binary -- apps/web/manifest/catalog/roles.ts apps/web/manifest/catalog/contract-types.ts
~~~

No command may include a user-controlled executable, a shell fragment, or a path outside the owned worktree.

- [ ] **Step 2: Write failing prepare-service tests**

Cover exact SHA success, stale SHA before worktree creation, one global prepare lock, source editor failure, validation failure, diff containing an unapproved path, cleanup on discard, expiry cleanup, and state transitions:

~~~text
draft -> validating -> awaiting-confirmation
                  \-> failed
~~~

- [ ] **Step 3: Write failing prepare route tests**

Assert Origin checking, content type, 64 KiB body limit, strict Zod parsing, server-generated ULID, exact current-model SHA, reference validation, empty-change rejection, and stable error codes. The browser payload must not choose a request ID, target repository, base branch, branch name, or filesystem path.

- [ ] **Step 4: Run and verify RED**

Run: <code>corepack pnpm vitest run src/jobs/validation.test.ts src/jobs/change-job-service.test.ts app/api/changes/prepare/route.test.ts</code>

Expected: FAIL because the services do not exist.

- [ ] **Step 5: Implement in-memory prepared jobs**

Store only bounded metadata, validation output summaries, diff, and owned worktree handles in memory. Keep detailed redacted logs under the owned log root. Prepared jobs expire after 30 minutes and are discarded explicitly or on process startup cleanup.

- [ ] **Step 6: Expose prepare, polling, and discard behavior**

<code>POST /api/changes/prepare</code> generates the ULID, validates all references against the exact current model, and starts preparation. <code>GET /api/changes/:id</code> returns state, summary, diff, validation steps, expiry, and later PR URL. It never returns absolute paths. <code>DELETE</code> discards only jobs still awaiting confirmation or failed.

- [ ] **Step 7: Verify and commit**

Run:

~~~text
corepack pnpm vitest run src/jobs app/api/changes
corepack pnpm typecheck
corepack pnpm build
~~~

Expected: PASS.

Commit: <code>feat(jobs): validate permission changes before push</code>

---

### Task 11: Final confirmation, push, and Draft PR

**Files:**
- Modify: <code>src/github/gh-client.ts</code>
- Modify: <code>src/jobs/change-job-service.ts</code>
- Create: <code>src/github/pr-body.ts</code>
- Test: <code>src/github/pr-body.test.ts</code>
- Test: <code>src/jobs/finalize-change.test.ts</code>
- Create: <code>app/api/changes/[id]/confirm/route.ts</code>
- Test: <code>app/api/changes/[id]/confirm/route.test.ts</code>

**Interfaces:**
- Consumes: an unexpired <code>awaiting-confirmation</code> job.
- Produces: <code>finalizeChange()</code> and a Draft PR URL.

- [ ] **Step 1: Write failing PR body tests**

Assert deterministic Markdown, HTML escaping, bounded reason, source SHA, actor, role/menu/widget tables, touched files, and validation results. No absolute local path or command output is allowed.

- [ ] **Step 2: Write failing finalize tests**

Assert:

- a second fetch still matches the prepared SHA;
- branch is <code>permission-studio/&lt;request-id-lowercase&gt;</code>;
- Git identity is derived from <code>gh api user</code> and configured only in the temporary worktree;
- commit uses a deterministic subject;
- push is non-force;
- <code>gh pr create</code> includes exact repo, <code>--base develop</code>, <code>--head</code>, <code>--draft</code>, and a body file;
- confirmation is idempotent after success;
- stale SHA before push fails and cleans up;
- push success plus PR failure keeps the remote branch and returns a redacted recovery command;
- successful PR creation cleans the local worktree.

- [ ] **Step 3: Run and verify RED**

Run: <code>corepack pnpm vitest run src/github/pr-body.test.ts src/jobs/finalize-change.test.ts app/api/changes/[id]/confirm/route.test.ts</code>

Expected: FAIL because finalization does not exist.

- [ ] **Step 4: Implement finalization**

Use these operations without shell interpolation:

~~~ts
await git(worktree.path, ["config", "user.name", viewer.login]);
await git(worktree.path, [
  "config",
  "user.email",
  viewer.noreplyEmail,
]);
await git(worktree.path, ["switch", "-c", job.branchName]);
await git(worktree.path, ["add", "--", ...ALLOWED_CATALOG_PATHS]);
await git(worktree.path, [
  "commit",
  "-m",
  "chore(permissions): apply Permission Studio change",
]);
await git(worktree.path, [
  "push",
  "origin",
  "HEAD:refs/heads/" + job.branchName,
]);
await gh([
  "pr",
  "create",
  "--repo",
  "Newland-Payment-Technology-US-Co-Ltd/pep-webapp",
  "--base",
  "develop",
  "--head",
  job.branchName,
  "--draft",
  "--title",
  job.title,
  "--body-file",
  job.prBodyPath,
]);
~~~

- [ ] **Step 5: Implement confirmation boundary**

Require same-origin POST and an opaque confirmation nonce issued with the prepared job. Consume the nonce once the push phase starts. Reject missing, expired, failed, discarded, already-running, or mismatched jobs with stable error codes.

- [ ] **Step 6: Verify and commit**

Run:

~~~text
corepack pnpm vitest run src/github src/jobs app/api/changes
corepack pnpm typecheck
corepack pnpm build
~~~

Expected: PASS.

Commit: <code>feat(github): create validated draft pull requests</code>

---

### Task 12: End-to-end UI integration without browser E2E

**Files:**
- Modify: <code>src/components/change-draft.tsx</code>
- Modify: <code>src/components/permission-workbench.tsx</code>
- Modify: <code>app/page.tsx</code>
- Modify: <code>app/globals.css</code>
- Test: <code>src/components/change-draft.test.tsx</code>
- Create: <code>README.md</code>

**Interfaces:**
- Connects the previously tested model, prepare, poll, confirm, discard, and recovery interfaces.

- [ ] **Step 1: Write failing component orchestration tests**

Mock fetch only at the HTTP boundary and assert:

~~~text
refresh model
edit role or contract owner
submit reason
receive validating state
poll awaiting-confirmation
render exact diff and validation results
confirm remote write
poll succeeded
render Draft PR link
~~~

Also assert stale, validation failure, discarded, expired, push-failed, and PR-create-failed recovery states.

- [ ] **Step 2: Run and verify RED**

Run: <code>corepack pnpm vitest run src/components/change-draft.test.tsx</code>

Expected: FAIL because prepare/finalize orchestration is not connected.

- [ ] **Step 3: Implement final UI state machine**

Never label the initial action “创建 PR”; use “验证变更”. Only the post-validation action may say “确认推送并创建 Draft PR”. Require the user to inspect a visible diff region before confirmation.

- [ ] **Step 4: Document local operation and recovery**

README must include:

~~~text
corepack enable
gh auth login
gh auth setup-git
gh auth status
corepack pnpm install
corepack pnpm dev
~~~

Document cache location, exact target/base, permissions required of the current user, no-token guarantee, stale-draft behavior, branch cleanup, PR failure recovery, no-E2E decision, and future GitHub App migration boundary.

- [ ] **Step 5: Run the full automated verification**

Run:

~~~text
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm exec tsx scripts/smoke-model.ts
git diff --check
~~~

Expected: all automated commands PASS. The smoke command is read-only and reports the current remote <code>develop</code> SHA plus permission, contract, and role counts.

- [ ] **Step 6: Perform manual localhost acceptance**

Start <code>corepack pnpm dev</code>, open <code>http://127.0.0.1:3100</code>, refresh the real model, edit one reversible permission in a draft, validate it, inspect the diff, and stop before final confirmation unless the user explicitly authorizes creation of a real branch and Draft PR.

Expected: all read-only and local validation behavior works; no remote ref is created without explicit final confirmation.

- [ ] **Step 7: Commit**

Commit: <code>docs: finish standalone permission studio</code>

---

## Completion Audit

Before declaring completion, inspect the design specification section by section and prove:

1. The repository is standalone and has no workspace dependency on <code>pep-webapp</code>.
2. A machine without an existing target checkout can read <code>origin/develop</code>.
3. Effective-permission explanations cover contract, plan, role, and ADMIN behavior.
4. Only allowed role/menu/widget edits can reach the AST editor and Git staging.
5. Stale SHA, unsupported AST, validation failure, and unapproved path all fail before remote writes.
6. Final diff and validation evidence are visible before confirmation.
7. Finalization only creates a prefixed branch and Draft PR to <code>develop</code>.
8. No code path invokes <code>gh auth token</code> or exposes credentials.
9. Unit, component, AST, Git integration, adapter, typecheck, lint, format, and production build evidence is fresh.
10. There is no Playwright/browser E2E requirement or implementation.
