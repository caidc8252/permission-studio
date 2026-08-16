import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();

export interface GitFixture {
  root: string;
  seedPath: string;
  remotePath: string;
  initialSha: string;
  advance(content: string): string;
  cleanup(): void;
}

export function createGitFixture(): GitFixture {
  const root = mkdtempSync(join(tmpdir(), "permission-studio-git-"));
  const seedPath = join(root, "seed");
  const remotePath = join(root, "remote.git");
  mkdirSync(seedPath);
  mkdirSync(remotePath);

  git(seedPath, ["init", "-b", "develop"]);
  git(seedPath, ["config", "user.name", "Permission Studio Test"]);
  git(seedPath, ["config", "user.email", "permission-studio@example.invalid"]);
  writeFileSync(join(seedPath, "fixture.txt"), "develop\n", "utf8");
  git(seedPath, ["add", "fixture.txt"]);
  git(seedPath, ["commit", "-m", "initial"]);
  const initialSha = git(seedPath, ["rev-parse", "HEAD"]);

  git(remotePath, ["init", "--bare"]);
  git(seedPath, ["remote", "add", "origin", resolve(remotePath)]);
  git(seedPath, ["push", "-u", "origin", "develop"]);

  return {
    root,
    seedPath,
    remotePath,
    initialSha,
    advance(content) {
      writeFileSync(join(seedPath, "fixture.txt"), content, "utf8");
      git(seedPath, ["add", "fixture.txt"]);
      git(seedPath, ["commit", "-m", "advance"]);
      git(seedPath, ["push", "origin", "develop"]);
      return git(seedPath, ["rev-parse", "HEAD"]);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
