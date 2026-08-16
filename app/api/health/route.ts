import { existsSync } from "node:fs";

import { NextResponse } from "next/server";

import { createGhClient, type GhPreflight } from "@/src/github/gh-client";
import { createCommandRunner } from "@/src/system/command-runner";
import { studioConfig } from "@/src/system/config";

interface HealthDependencies {
  preflight(): Promise<GhPreflight>;
  cacheReady(): boolean;
}

export function createHealthHandler(dependencies: HealthDependencies) {
  return async function GET() {
    const preflight = await dependencies.preflight();
    const body = {
      ready: preflight.ready,
      authenticated: preflight.authenticated,
      repositoryAccessible: preflight.repositoryAccessible,
      canWrite: preflight.canWrite,
      ...(preflight.login ? { login: preflight.login } : {}),
      ...(preflight.viewerPermission ? { viewerPermission: preflight.viewerPermission } : {}),
      ...(preflight.errorCode ? { errorCode: preflight.errorCode } : {}),
      cacheReady: dependencies.cacheReady(),
    };
    return NextResponse.json(body, { status: preflight.ready ? 200 : 503 });
  };
}

const ghClient = createGhClient(createCommandRunner());

export const dynamic = "force-dynamic";
export const GET = createHealthHandler({
  preflight: () => ghClient.preflight(),
  cacheReady: () => existsSync(studioConfig.cacheRepoPath),
});
