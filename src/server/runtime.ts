import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createGhClient } from "@/src/github/gh-client";
import { createRepositoryCache } from "@/src/git/repository-cache";
import { createRemoteModelLoader } from "@/src/pep-webapp/model-loader";
import { applyPermissionChange } from "@/src/pep-webapp/apply-change.mjs";
import { createChangeJobService } from "@/src/jobs/change-job-service";
import { createChangeJobStore } from "@/src/jobs/change-job-store";
import { runTargetValidation } from "@/src/jobs/validation";
import { createCommandRunner } from "@/src/system/command-runner";
import { studioConfig } from "@/src/system/config";
import { currentPnpmCommand } from "@/src/system/package-manager";

export const commandRunner = createCommandRunner();
export const ghClient = createGhClient(commandRunner);

export const repositoryCache = createRepositoryCache({
  runner: commandRunner,
  cacheRepoPath: studioConfig.cacheRepoPath,
  worktreeRoot: studioConfig.worktreeRoot,
  targetSlug: studioConfig.targetSlug,
  baseBranch: studioConfig.target.baseBranch,
});

export const remoteModelLoader = createRemoteModelLoader({
  cache: repositoryCache,
  runner: commandRunner,
  modelCacheRoot: studioConfig.modelCacheRoot,
  exporterPath: join(process.cwd(), "src", "pep-webapp", "export-model.mjs"),
  pnpmCommand: currentPnpmCommand,
});

export const changeJobStore = createChangeJobStore();

export const changeJobService = createChangeJobService({
  store: changeJobStore,
  cache: repositoryCache,
  applyChange: applyPermissionChange,
  validate: (worktreePath) =>
    runTargetValidation({
      runner: commandRunner,
      worktreeRoot: studioConfig.worktreeRoot,
      worktreePath,
      pnpmCommand: currentPnpmCommand,
    }),
  nonce: () => randomBytes(24).toString("base64url"),
  finalization: {
    runner: commandRunner,
    getViewer: () => ghClient.getViewer(),
    createDraftPullRequest: (input) => ghClient.createDraftPullRequest(input),
    async writeBody(worktreePath, body) {
      const path = join(worktreePath, ".permission-studio-pr.md");
      await writeFile(path, body, "utf8");
      return path;
    },
  },
});
