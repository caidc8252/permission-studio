import { join } from "node:path";

import { createRepositoryCache } from "@/src/git/repository-cache";
import { createRemoteModelLoader } from "@/src/pep-webapp/model-loader";
import { createCommandRunner } from "@/src/system/command-runner";
import { studioConfig } from "@/src/system/config";
import { currentPnpmCommand } from "@/src/system/package-manager";

export const commandRunner = createCommandRunner();

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
