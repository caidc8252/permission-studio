import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CommandExecutionError } from "@/src/system/command-runner";

const REQUEST_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const MAX_LOG_BYTES = 64 * 1024;
const SECRETS = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/gu,
  /https:\/\/x-access-token:[^@\s]+@/gu,
  /[A-Z]:\\Users\\[^\\\s]+/giu,
];

function redact(value: string): string {
  return SECRETS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
}

function bounded(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  return bytes.byteLength <= MAX_LOG_BYTES
    ? value
    : `${bytes.subarray(0, MAX_LOG_BYTES - 32).toString("utf8")}\n[OUTPUT TRUNCATED]\n`;
}

export function createJobFailureLogger(logRoot: string) {
  return async (requestId: string, phase: "prepare" | "finalize", error: unknown) => {
    if (!REQUEST_ID.test(requestId)) throw new Error("Invalid log request ID");
    const detail =
      error instanceof CommandExecutionError
        ? {
            error: error.code,
            executable: error.executable,
            exitCode: error.exitCode,
            stdout: error.stdout,
            stderr: error.stderr,
          }
        : { error: error instanceof Error ? error.message : "Unknown failure" };
    const content = bounded(
      redact(`${JSON.stringify({ phase, at: new Date().toISOString(), ...detail }, null, 2)}\n`),
    );
    await mkdir(logRoot, { recursive: true });
    await writeFile(join(logRoot, `${requestId}.log`), content, "utf8");
  };
}
