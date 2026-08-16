import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { studioConfig } from "@/src/system/config";

describe("studioConfig", () => {
  it("fixes the target repository, base branch, and branch namespace", () => {
    expect(studioConfig.target).toEqual({
      owner: "Newland-Payment-Technology-US-Co-Ltd",
      repo: "pep-webapp",
      baseBranch: "develop",
      branchPrefix: "permission-studio/",
    });
  });

  it("keeps every mutable runtime path under LocalAppData", () => {
    expect(process.env.LOCALAPPDATA).toBeTruthy();
    expect(studioConfig.cacheRoot.startsWith(process.env.LOCALAPPDATA!)).toBe(true);
    expect(studioConfig.cacheRepoPath).toBe(
      join(studioConfig.cacheRoot, "cache", "pep-webapp.git"),
    );
    expect(studioConfig.worktreeRoot).toBe(join(studioConfig.cacheRoot, "worktrees"));
    expect(studioConfig.logRoot).toBe(join(studioConfig.cacheRoot, "logs"));
    expect(studioConfig.modelCacheRoot).toBe(join(studioConfig.cacheRoot, "models"));
  });
});
