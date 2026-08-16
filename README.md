# Permission Studio

本地运行的 `pep-webapp` 权限查看器与变更生成器。它从远端 `develop` 读取契约、套餐、角色、菜单、组件和权限声明，解释最终有效权限；受支持的修改会先在隔离 worktree 中验证，只有再次确认后才推送分支并创建 Draft PR。

## 本地启动

要求 Node.js 24+、pnpm 10+、Git 和 GitHub CLI。首次使用先完成 GitHub CLI 登录：

```text
corepack enable
gh auth login
gh auth setup-git
gh auth status
corepack pnpm install
corepack pnpm dev
```

打开 `http://127.0.0.1:3100`。首次读取需要浅克隆目标仓库并安装其依赖，因此会比后续刷新慢。

目标固定为：

- 仓库：`Newland-Payment-Technology-US-Co-Ltd/pep-webapp`
- 基线：`develop`
- 写回分支：`permission-studio/<request-id>`
- 产物：以 `develop` 为 base 的 Draft PR

当前 `gh` 用户必须能读取私有仓库；创建 PR 还需要 `WRITE`、`MAINTAIN` 或 `ADMIN` 权限。

## 工作流

1. 刷新远端模型，选择成员类型、契约、套餐和角色，查看最终权限及阻止原因。
2. 编辑 `preset_` 角色权限，或编辑非 `TEST` 契约挂载的菜单/组件。
3. 填写原因并点击“验证变更”。这一步只改本地临时 worktree，不创建远端分支。
4. 查看目标项目的校验结果和完整 diff，勾选“我已检查 diff”。
5. 点击“确认推送并创建 Draft PR”，系统再次确认 `develop` SHA 后才提交、推送和创建 PR。

如果远端 `develop` 在准备前或最终确认前发生变化，草稿会以 `STALE_MODEL` 失败；刷新模型后重新创建草稿，不会自动把旧变更套到新基线上。

## 本地数据与清理

缓存默认位于：

- Windows：`%LOCALAPPDATA%\permission-studio`
- 其他系统：`$XDG_DATA_HOME/permission-studio`，未设置时使用用户数据目录下的 `.local/share/permission-studio`

其中包含裸仓库缓存、按请求创建的 worktree、模型 JSON 和不超过 64 KiB 的脱敏失败日志（最多保留 100 份或 7 天）。准备结果默认 30 分钟过期；丢弃、过期和成功创建 PR 都会清理对应本地 worktree。失败任务会保留受控 worktree 作为诊断证据，点击界面的“丢弃”后才会清理。

成功创建 PR 后，远端分支保留给 GitHub PR 使用。合并或关闭 PR 后，可按团队惯例删除远端分支。如果 push 已成功但 `gh pr create` 失败，界面会显示不含本地路径和凭证的恢复命令；远端分支不会被自动删除。

## 安全边界

- 应用只调用本机已经登录的 `gh`，不会执行 `gh auth token`，不会读取、存储或返回 GitHub token。
- 浏览器不能选择仓库、base、分支名、request ID 或文件路径。
- 命令通过参数数组执行，不使用 shell 拼接；输出有大小和超时限制，并会遮蔽常见 token 格式。
- AST 编辑器只接受静态、已知的角色/契约数组；动态或计算属性会 fail closed。
- Git 只 stage `roles.ts` 和 `contract-types.ts` 两个允许文件；远端写入前必须通过格式化、目录测试、类型检查和 `git diff --check`。
- `TEST` 契约和非 `preset_` 角色只读。

## 验证

```text
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm exec tsx scripts/smoke-model.ts
git diff --check
```

第一版按约定不包含 Playwright 或浏览器 E2E；领域、组件、AST、Git 集成、API 适配器和生产构建由自动化测试覆盖。真实 localhost 验收应停在最终确认之前，除非操作者明确授权创建远端分支和 Draft PR。

## 未来迁移到 GitHub App

当前 GitHub 边界集中在服务端 `gh` 客户端、仓库缓存和 job finalization。未来改成 GitHub App 时，可替换身份获取、Git 数据访问、push/PR 创建和持久化 job 实现；权限模型、AST 编辑、验证序列、HTTP 意图协议和前端确认流程无需改成在浏览器里持有凭证。
