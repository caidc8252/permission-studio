import { describe, expect, it } from "vitest";

import { createHealthHandler } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns a bounded ready response with cache state", async () => {
    const handler = createHealthHandler({
      preflight: async () => ({
        ready: true,
        authenticated: true,
        repositoryAccessible: true,
        canWrite: true,
        login: "caidc8252",
        viewerPermission: "ADMIN",
      }),
      cacheReady: () => false,
      expectedOrigin: "http://127.0.0.1:3100",
    });

    const response = await handler(new Request("http://127.0.0.1:3100/api/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ready: true,
      authenticated: true,
      repositoryAccessible: true,
      canWrite: true,
      login: "caidc8252",
      viewerPermission: "ADMIN",
      cacheReady: false,
    });
  });

  it("uses 503 for an actionable failed preflight", async () => {
    const handler = createHealthHandler({
      preflight: async () => ({
        ready: false,
        authenticated: false,
        repositoryAccessible: false,
        canWrite: false,
        errorCode: "GH_NOT_AUTHENTICATED",
      }),
      cacheReady: () => false,
      expectedOrigin: "http://127.0.0.1:3100",
    });

    const response = await handler(new Request("http://127.0.0.1:3100/api/health"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ready: false,
      errorCode: "GH_NOT_AUTHENTICATED",
    });
  });
});
