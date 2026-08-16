import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { permissionStudioModelSchema, type PermissionStudioModel } from "@/src/domain/model";
import type { RepositoryCache } from "@/src/git/repository-cache";
import type { CommandRunner } from "@/src/system/command-runner";
import type { PnpmCommand } from "@/src/system/package-manager";

export interface RemoteModelLoader {
  load(): Promise<PermissionStudioModel>;
}

export interface RemoteModelLoaderOptions {
  cache: RepositoryCache;
  runner: CommandRunner;
  modelCacheRoot: string;
  exporterPath: string;
  pnpmCommand?: PnpmCommand;
}

function parseModel(raw: string, expectedSha: string): PermissionStudioModel {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error("Permission model export returned invalid JSON");
  }
  const model = permissionStudioModelSchema.parse(input);
  if (model.sourceSha !== expectedSha) {
    throw new Error(
      `Permission model source SHA "${model.sourceSha}" does not match fetched SHA "${expectedSha}"`,
    );
  }
  return model;
}

export function createRemoteModelLoader(options: RemoteModelLoaderOptions): RemoteModelLoader {
  const modelCacheRoot = resolve(options.modelCacheRoot);
  const exporterPath = resolve(options.exporterPath);
  const pnpmCommand = options.pnpmCommand ?? {
    executable: "corepack",
    argsPrefix: ["pnpm"],
  };
  let inFlight: Promise<PermissionStudioModel> | undefined;

  const performLoad = async (): Promise<PermissionStudioModel> => {
    const revision = await options.cache.refresh();
    const cachePath = join(modelCacheRoot, `${revision.sha}.json`);
    if (existsSync(cachePath)) {
      return parseModel(await readFile(cachePath, "utf8"), revision.sha);
    }

    const requestId = revision.sha.slice(0, 26).toUpperCase();
    const worktree = await options.cache.createWorktree(requestId, revision.sha);
    try {
      await options.runner.run({
        executable: pnpmCommand.executable,
        args: [...pnpmCommand.argsPrefix, "install", "--frozen-lockfile", "--ignore-scripts"],
        cwd: worktree.path,
        timeoutMs: 600_000,
        maxOutputBytes: 4 * 1024 * 1024,
      });
      await options.runner.run({
        executable: pnpmCommand.executable,
        args: [...pnpmCommand.argsPrefix, "gen:coc"],
        cwd: worktree.path,
        timeoutMs: 300_000,
        maxOutputBytes: 4 * 1024 * 1024,
      });
      const exported = await options.runner.run({
        executable: process.execPath,
        args: [exporterPath, worktree.path, revision.sha],
        cwd: worktree.path,
        timeoutMs: 120_000,
        maxOutputBytes: 12 * 1024 * 1024,
      });
      const model = parseModel(exported.stdout, revision.sha);

      await mkdir(modelCacheRoot, { recursive: true });
      const temporaryPath = `${cachePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
      await rename(temporaryPath, cachePath);
      return model;
    } finally {
      await options.cache.removeWorktree(worktree);
    }
  };

  return {
    async load() {
      if (inFlight) return inFlight;
      inFlight = performLoad();
      try {
        return await inFlight;
      } finally {
        inFlight = undefined;
      }
    },
  };
}
