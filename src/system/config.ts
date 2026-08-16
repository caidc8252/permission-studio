import { homedir } from "node:os";
import { join, resolve } from "node:path";

const localDataRoot =
  process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
const cacheRoot = resolve(localDataRoot, "permission-studio");

const target = Object.freeze({
  owner: "Newland-Payment-Technology-US-Co-Ltd",
  repo: "pep-webapp",
  baseBranch: "develop",
  branchPrefix: "permission-studio/",
});

export const studioConfig = Object.freeze({
  target,
  targetSlug: `${target.owner}/${target.repo}`,
  serverOrigin: "http://127.0.0.1:3100",
  cacheRoot,
  cacheRepoPath: join(cacheRoot, "cache", "pep-webapp.git"),
  worktreeRoot: join(cacheRoot, "worktrees"),
  logRoot: join(cacheRoot, "logs"),
});
