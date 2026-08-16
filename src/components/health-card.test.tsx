// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthCard } from "@/src/components/health-card";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HealthCard", () => {
  it("shows the current gh user when the environment is ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ready: true,
            authenticated: true,
            repositoryAccessible: true,
            canWrite: true,
            login: "caidc8252",
            viewerPermission: "ADMIN",
            cacheReady: false,
          }),
          { status: 200 },
        ),
      ),
    );

    render(<HealthCard />);

    expect(await screen.findByText("环境已就绪")).toBeVisible();
    expect(screen.getByText("@caidc8252")).toBeVisible();
    expect(screen.getByText("首次刷新时创建")).toBeVisible();
  });

  it("shows gh login commands when authentication is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ready: false,
            authenticated: false,
            repositoryAccessible: false,
            canWrite: false,
            cacheReady: false,
            errorCode: "GH_NOT_AUTHENTICATED",
          }),
          { status: 503 },
        ),
      ),
    );

    render(<HealthCard />);

    expect(await screen.findByText("需要登录 GitHub CLI")).toBeVisible();
    expect(screen.getByText("gh auth login")).toBeVisible();
    expect(screen.getByText("gh auth setup-git")).toBeVisible();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/health"));
  });
});
