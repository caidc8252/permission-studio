import { dirname, join } from "node:path";

export interface PnpmCommand {
  executable: string;
  argsPrefix: string[];
}

export interface PnpmResolutionInput {
  platform: NodeJS.Platform;
  execPath: string;
  npmExecPath?: string;
}

export function resolvePnpmCommand(input: PnpmResolutionInput): PnpmCommand {
  if (input.npmExecPath && /\.[cm]?js$/i.test(input.npmExecPath)) {
    return {
      executable: input.execPath,
      argsPrefix: [input.npmExecPath],
    };
  }
  if (input.platform === "win32") {
    return {
      executable: input.execPath,
      argsPrefix: [
        join(dirname(input.execPath), "node_modules", "corepack", "dist", "corepack.js"),
        "pnpm",
      ],
    };
  }
  return {
    executable: "corepack",
    argsPrefix: ["pnpm"],
  };
}

export const currentPnpmCommand = resolvePnpmCommand({
  platform: process.platform,
  execPath: process.execPath,
  npmExecPath: process.env.npm_execpath,
});
