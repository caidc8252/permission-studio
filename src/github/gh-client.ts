import { z } from "zod";

import { CommandExecutionError, type CommandRunner } from "@/src/system/command-runner";
import { studioConfig } from "@/src/system/config";

const viewerSchema = z.object({
  login: z.string().min(1).max(100),
  id: z.number().int().positive(),
});
const repositorySchema = z.object({
  nameWithOwner: z.string(),
  isPrivate: z.boolean(),
  viewerPermission: z.string(),
});

export interface GhViewer {
  login: string;
  id: number;
  noreplyEmail: string;
}

export type GhPreflightErrorCode =
  | "GH_NOT_AUTHENTICATED"
  | "GH_NOT_INSTALLED"
  | "GH_REPOSITORY_INACCESSIBLE"
  | "GH_REPOSITORY_WRITE_REQUIRED"
  | "GH_RESPONSE_INVALID";

export interface GhPreflight {
  ready: boolean;
  authenticated: boolean;
  repositoryAccessible: boolean;
  canWrite: boolean;
  login?: string;
  viewer?: GhViewer;
  viewerPermission?: string;
  errorCode?: GhPreflightErrorCode;
}

export interface GhClient {
  preflight(): Promise<GhPreflight>;
}

const baseFailure = (errorCode: GhPreflightErrorCode): GhPreflight => ({
  ready: false,
  authenticated: false,
  repositoryAccessible: false,
  canWrite: false,
  errorCode,
});

function parseJson<T>(schema: z.ZodType<T>, raw: string): T | undefined {
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function createGhClient(runner: CommandRunner): GhClient {
  return {
    async preflight() {
      try {
        await runner.run({
          executable: "gh",
          args: ["auth", "status", "--hostname", "github.com"],
          timeoutMs: 15_000,
        });
      } catch (error) {
        return baseFailure(
          error instanceof CommandExecutionError && error.code === "COMMAND_START_FAILED"
            ? "GH_NOT_INSTALLED"
            : "GH_NOT_AUTHENTICATED",
        );
      }

      let viewer: GhViewer;
      try {
        const result = await runner.run({
          executable: "gh",
          args: ["api", "user"],
          timeoutMs: 15_000,
        });
        const parsed = parseJson(viewerSchema, result.stdout);
        if (!parsed) {
          return {
            ...baseFailure("GH_RESPONSE_INVALID"),
            authenticated: true,
          };
        }
        viewer = {
          ...parsed,
          noreplyEmail: `${parsed.id}+${parsed.login}@users.noreply.github.com`,
        };
      } catch {
        return {
          ...baseFailure("GH_RESPONSE_INVALID"),
          authenticated: true,
        };
      }

      let repository: z.infer<typeof repositorySchema>;
      try {
        const result = await runner.run({
          executable: "gh",
          args: [
            "repo",
            "view",
            studioConfig.targetSlug,
            "--json",
            "nameWithOwner,isPrivate,viewerPermission",
          ],
          timeoutMs: 15_000,
        });
        const parsed = parseJson(repositorySchema, result.stdout);
        if (!parsed || parsed.nameWithOwner !== studioConfig.targetSlug) {
          return {
            ...baseFailure("GH_RESPONSE_INVALID"),
            authenticated: true,
            login: viewer.login,
            viewer,
          };
        }
        repository = parsed;
      } catch {
        return {
          ...baseFailure("GH_REPOSITORY_INACCESSIBLE"),
          authenticated: true,
          login: viewer.login,
          viewer,
        };
      }

      const canWrite = ["WRITE", "MAINTAIN", "ADMIN"].includes(repository.viewerPermission);
      return {
        ready: canWrite,
        authenticated: true,
        login: viewer.login,
        viewer,
        repositoryAccessible: true,
        viewerPermission: repository.viewerPermission,
        canWrite,
        ...(canWrite
          ? {}
          : {
              errorCode: "GH_REPOSITORY_WRITE_REQUIRED" satisfies GhPreflightErrorCode,
            }),
      };
    },
  };
}
