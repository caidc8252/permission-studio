# Permission Studio 独立项目设计

**日期：** 2026-08-16  
**状态：** 已由用户确认，第一版实施中
**目标仓库：** `Newland-Payment-Technology-US-Co-Ltd/pep-webapp`  
**目标分支：** `develop`

## 1. 目标

在 `F:\codes\permission-studio` 建立一个独立 Git 仓库和独立 Next.js 应用，用于查看、解释和编辑 `pep-webapp` 的权限配置。

Permission Studio 不依赖开发者现有的 `pep-webapp` checkout 或 worktree。它从 GitHub 获取 `pep-webapp/develop`，把权限变更应用到精确的基准提交，在本地完成验证，然后推送 `permission-studio/*` 分支并通过 `gh pr create --draft` 向 `pep-webapp` 创建 Draft PR。

第一版只面向 localhost 单用户运行，复用本机 `gh auth login` 的凭据，不使用 GitHub App、PAT 管理、数据库或远程部署。

## 2. 已选方案与备选方案

### 2.1 已选：本机 GitHub CLI 身份

Permission Studio 的服务端通过参数化子进程调用 `gh` 和 `git`。启动时执行只读环境检查，确认：

- `gh` 和 `git` 可用；
- `gh auth status` 成功；
- 当前账号可以访问目标私有仓库；
- 远端存在 `develop` 分支。

真实分支和 PR 只会在用户完成最终确认后创建。PR 归属于当前 `gh` 登录用户。

### 2.2 未选：Fine-grained PAT

PAT 适合共享测试服务器，但需要生命周期管理，并绑定某个用户或机器人账号。第一版本地运行没有必要引入这套秘密管理。

### 2.3 未选：GitHub App

GitHub App 是长期多人部署的优选方案，但当前阶段会增加注册、安装、私钥管理和 OAuth 流程。第一版保留清晰的 GitHub 身份适配边界，以便未来替换实现。

### 2.4 未选：补丁下载后手动提交

纯补丁方案最少权限，但无法实现用户期望的“一键反馈到 pep-webapp”。它只作为推送成功而 PR 创建失败时的人工恢复手段。

## 3. 总体架构

```text
F:\codes\permission-studio
  └─ Next.js localhost 应用
       ├─ 权限工作台
       ├─ 权限领域引擎
       ├─ pep-webapp 适配器
       ├─ Git/GH 适配器
       └─ 串行任务执行器
              │
              ▼
%LOCALAPPDATA%\permission-studio
  ├─ cache\pep-webapp.git       持久 Git 缓存
  ├─ worktrees\<request-id>     每次提交的临时工作树
  └─ logs\<request-id>.log      脱敏任务日志
              │
              ▼
GitHub: Newland-Payment-Technology-US-Co-Ltd/pep-webapp
  ├─ origin/develop
  ├─ permission-studio/<request-id>
  └─ Draft PR -> develop
```

### 3.1 应用边界

- `app/`：Next.js 页面和 localhost API。
- `src/domain/`：权限计算、草稿、影响分析和版本化变更协议。
- `src/pep-webapp/`：模型提取、AST 源码编辑和目标仓库验证。
- `src/git/`：命令执行、仓库缓存、worktree 生命周期和 `gh` 调用。
- `src/jobs/`：串行提交任务、状态机、日志和恢复信息。
- `tests/fixtures/pep-webapp/`：精简源码夹具和临时 Git 仓库输入。

界面、领域规则、目标仓库适配器和 GitHub 身份实现互相隔离。未来引入 GitHub App 时，只替换身份和远程操作适配器，不重写权限工作台。

## 4. 权限语义和可编辑范围

最终权限按以下规则计算：

```text
有效权限 = 契约/套餐允许范围 ∩ 已选角色权限并集
```

ADMIN 成员身份绕过角色限制，但不会绕过契约或套餐范围。

第一版允许修改：

- GLOBAL 预设角色的权限分配；
- 真实契约挂载的菜单；
- 真实契约挂载的 Widget。

第一版禁止修改：

- 权限码定义；
- `availableWhen`；
- 套餐策略；
- PRIVATE 角色；
- party 契约实例；
- 成员角色分配；
- `TEST` 契约；
- `.github`、依赖文件、CI 和权限范围之外的应用源码。

所有源码写入都经过 AST 结构识别和文件白名单。遇到动态表达式、未知展开结构或目录漂移时失败关闭，不猜测写入。

## 5. 仓库缓存和模型生成

### 5.1 缓存

Permission Studio 在 `%LOCALAPPDATA%\permission-studio\cache` 维护自己的 Git 缓存，不读取用户现有 checkout。

刷新操作：

1. 验证 `gh` 登录和目标仓库访问权限；
2. 首次运行时克隆目标仓库缓存，后续运行执行 fetch；
3. 解析 `origin/develop` 的精确 SHA；
4. 从该 SHA 创建只读模型工作树；
5. 生成权限模型；
6. 将模型和 `sourceSha` 返回界面。

生成模型可以使用目标仓库自己的生成脚本和依赖，但必须在隔离工作树内执行。依赖安装使用锁文件，pnpm store 可以复用。生成产物不提交到 Permission Studio 仓库。

### 5.2 过期控制

每个草稿绑定 `sourceSha`。提交前再次 fetch 并比较 `origin/develop`：

- SHA 相同：允许继续；
- SHA 不同：草稿标记过期，禁止创建分支和 PR；
- 用户刷新后，系统重新生成模型和影响差异。

## 6. 界面设计

工作台采用三栏响应式布局。

### 6.1 左栏：模拟条件

- 契约类型；
- 套餐；
- 成员类型；
- 角色组合；
- 远端刷新状态和当前 `develop` SHA。

### 6.2 中栏：最终结果

- 有效权限；
- 被角色允许但被契约阻断的权限；
- 被套餐阻断的权限；
- 每个权限的授予与阻断解释；
- 最终菜单树和 Widget。

状态不能只靠颜色表达，必须同时显示文本或图标含义。

### 6.3 右栏：变更草稿

- 预设角色权限编辑；
- 契约菜单和 Widget 编辑；
- 影响摘要；
- 变更原因；
- 源码差异预览；
- 最终确认；
- 任务状态、日志入口和 Draft PR 链接。

没有修改、原因不足、草稿过期或验证失败时，创建 PR 按钮不可用。

## 7. 提交流程

```text
用户刷新 develop
→ 编辑并生成结构化变更
→ 预览影响和计划修改文件
→ 提交前重新验证远端 SHA
→ 获取全局任务锁
→ 从精确 SHA 创建临时 worktree
→ AST 修改白名单文件
→ 运行生成器、格式化、聚焦测试和类型检查
→ 生成最终 git diff
→ 用户最终确认
→ 创建 permission-studio/<request-id> 分支
→ commit 并 push
→ gh pr create --base develop --draft
→ 返回 PR URL
→ 清理临时 worktree并释放锁
```

最终确认发生在源码修改和本地验证之后、任何远端写操作之前。用户可以先检查实际 diff，再决定是否推送。

PR 描述包含：

- 当前 `gh` 用户；
- 基准 commit SHA；
- 变更原因；
- 角色权限增删；
- 契约菜单/Widget 增删；
- 修改文件；
- 自动验证结果；
- Permission Studio 生成标识。

## 8. 命令执行和安全

- 本地服务默认只绑定 `127.0.0.1:3100`。
- API 校验 `Origin`，只接受本地应用来源。
- `git`、`gh`、`pnpm` 都通过 executable + args 数组启动，禁止拼接 shell 命令。
- 目标仓库固定为 `Newland-Payment-Technology-US-Co-Ltd/pep-webapp`。
- base 固定为 `develop`。
- 远端分支固定使用 `permission-studio/` 前缀。
- 请求 ID、角色码、契约码、权限码和变更原因都有长度与字符约束。
- Token、认证 URL和敏感环境变量不得进入浏览器、错误响应或日志。
- 删除 worktree 前验证其解析后绝对路径位于专用缓存目录。
- 同一进程一次只执行一个写任务；发现陈旧锁时先验证对应进程和目录状态。
- 禁止强推，禁止直接推送 `develop`，禁止自动合并。

## 9. 状态与失败恢复

任务状态：

```text
draft -> validating -> awaiting-confirmation -> pushing -> creating-pr -> succeeded
                                          \-> failed
```

失败行为：

- `gh` 未登录：展示 `gh auth login` 和 `gh auth status` 指引；
- 缺少仓库权限：停止，不尝试其他身份；
- 网络失败：保留浏览器草稿，允许重新刷新；
- SHA 过期：禁止提交并要求刷新；
- AST 不支持：不写文件、不推分支；
- 生成或测试失败：保留脱敏日志和临时 diff，等待用户查看后清理；
- push 失败：不创建 PR，显示可重试阶段；
- push 成功但 PR 创建失败：保留远端分支，返回精确的人工恢复命令；
- 应用重启：第一版不恢复正在执行的任务，但会在启动检查中识别和安全清理遗留 worktree。

## 10. 测试策略

第一版不实现 Playwright 或其他浏览器 E2E。

自动验证包括：

- 领域单元测试：契约、套餐、角色、ADMIN、草稿和影响分析；
- 组件测试：编辑交互、过期草稿、确认状态和错误提示；
- AST 测试：注释、展开数组、换行符、尾逗号、幂等和失败关闭；
- Git 集成测试：临时 bare repository 中的 fetch、SHA、worktree、commit、push 和清理；
- `gh` 适配器测试：使用假的命令执行器验证参数、输出解析和错误映射；
- 生产构建；
- TypeScript 类型检查；
- ESLint 和 Prettier 检查。

真实 GitHub 默认只做以下只读检查：

```text
gh auth status
gh repo view Newland-Payment-Technology-US-Co-Ltd/pep-webapp
git ls-remote https://github.com/Newland-Payment-Technology-US-Co-Ltd/pep-webapp.git refs/heads/develop
```

完成第一版后，由用户在 localhost 手动执行一次真实 Draft PR 验收。自动测试和应用启动不会创建真实分支或 PR。

## 11. 第一版非目标

- GitHub App；
- Permission Studio 管理 PAT；
- 多用户登录或授权；
- 远程部署；
- 数据库；
- Webhook；
- 浏览器 E2E；
- 多个目标仓库或可编辑 base 分支；
- 自动合并或绕过 `pep-webapp` 分支保护；
- 权限范围之外的通用源码编辑器。

## 12. 验收标准

1. 项目可以在 `F:\codes\permission-studio` 独立安装和启动。
2. 不存在本地 `pep-webapp` checkout 时，仍能通过 GitHub 获取 `develop` 并生成模型。
3. 可以准确解释契约、套餐和角色组合后的最终权限。
4. 只能编辑约定的角色权限和契约菜单/Widget。
5. 远端 `develop` 变化后，旧草稿无法提交。
6. 不支持的源码结构不会产生部分写入。
7. 用户在推送前能看到最终源码 diff 和验证结果。
8. 最终确认后创建 `permission-studio/*` 分支和面向 `develop` 的 Draft PR。
9. Permission Studio 不读取或存储 GitHub Token，浏览器永远无法获得凭据。
10. 所有自动测试、构建、类型检查和静态检查通过；浏览器 E2E 不在第一版验收范围。
