import { describe, expect, it } from "vitest";

import { resolvePnpmCommand } from "@/src/system/package-manager";

describe("resolvePnpmCommand", () => {
  it("reuses the active pnpm JavaScript entry without a shell", () => {
    expect(
      resolvePnpmCommand({
        platform: "win32",
        execPath: "C:\\node\\node.exe",
        npmExecPath: "C:\\corepack\\pnpm\\bin\\pnpm.cjs",
      }),
    ).toEqual({
      executable: "C:\\node\\node.exe",
      argsPrefix: ["C:\\corepack\\pnpm\\bin\\pnpm.cjs"],
    });
  });

  it("falls back to Corepack's JavaScript entry on Windows", () => {
    expect(
      resolvePnpmCommand({
        platform: "win32",
        execPath: "C:\\Program Files\\nodejs\\node.exe",
      }),
    ).toEqual({
      executable: "C:\\Program Files\\nodejs\\node.exe",
      argsPrefix: ["C:\\Program Files\\nodejs\\node_modules\\corepack\\dist\\corepack.js", "pnpm"],
    });
  });

  it("uses the corepack executable on non-Windows platforms", () => {
    expect(
      resolvePnpmCommand({
        platform: "linux",
        execPath: "/usr/bin/node",
      }),
    ).toEqual({
      executable: "corepack",
      argsPrefix: ["pnpm"],
    });
  });
});
