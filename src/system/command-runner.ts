import { spawn } from "node:child_process";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const AUTOMATIC_REDACTIONS = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/g,
  /https:\/\/x-access-token:[^@\s]+@/g,
];

export type CommandErrorCode =
  | "COMMAND_FAILED"
  | "COMMAND_OUTPUT_LIMIT"
  | "COMMAND_START_FAILED"
  | "COMMAND_TIMEOUT";

export interface CommandSpec {
  executable: string;
  args: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes?: number;
  redactions?: readonly string[];
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

interface CommandErrorInput extends CommandResult {
  code: CommandErrorCode;
  executable: string;
}

export class CommandExecutionError extends Error {
  readonly code: CommandErrorCode;
  readonly executable: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;

  constructor(input: CommandErrorInput) {
    super(`${input.executable} failed: ${input.code}`);
    this.name = "CommandExecutionError";
    this.code = input.code;
    this.executable = input.executable;
    this.exitCode = input.exitCode;
    this.stdout = input.stdout;
    this.stderr = input.stderr;
    this.durationMs = input.durationMs;
  }
}

function redact(value: string, literals: readonly string[]): string {
  let redacted = value;
  for (const literal of literals) {
    if (literal) redacted = redacted.replaceAll(literal, "[REDACTED]");
  }
  for (const pattern of AUTOMATIC_REDACTIONS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function mergedEnvironment(overrides?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return overrides ? { ...process.env, ...overrides } : process.env;
}

export function createCommandRunner(): CommandRunner {
  return {
    run(spec) {
      return new Promise<CommandResult>((resolvePromise, rejectPromise) => {
        const startedAt = Date.now();
        const maxBytes = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
        let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let forcedCode: CommandErrorCode | undefined;
        let spawnError: Error | undefined;

        const child = spawn(spec.executable, [...spec.args], {
          cwd: spec.cwd,
          env: mergedEnvironment(spec.env),
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });

        const append = (
          current: Buffer<ArrayBufferLike>,
          chunk: Buffer<ArrayBufferLike>,
        ): Buffer<ArrayBufferLike> => {
          if (current.byteLength + chunk.byteLength > maxBytes) {
            forcedCode ??= "COMMAND_OUTPUT_LIMIT";
            child.kill();
            return current;
          }
          return Buffer.concat([current, chunk]);
        };

        child.stdout.on("data", (chunk: Buffer<ArrayBufferLike>) => {
          stdout = append(stdout, chunk);
        });
        child.stderr.on("data", (chunk: Buffer<ArrayBufferLike>) => {
          stderr = append(stderr, chunk);
        });
        child.on("error", (error) => {
          spawnError = error;
        });

        const timeout = setTimeout(() => {
          forcedCode ??= "COMMAND_TIMEOUT";
          child.kill();
        }, spec.timeoutMs);
        timeout.unref();

        child.on("close", (exitCode) => {
          clearTimeout(timeout);
          const result: CommandResult = {
            exitCode: exitCode ?? -1,
            stdout: redact(stdout.toString("utf8"), spec.redactions ?? []),
            stderr: redact(stderr.toString("utf8"), spec.redactions ?? []),
            durationMs: Date.now() - startedAt,
          };

          const code =
            forcedCode ??
            (spawnError
              ? "COMMAND_START_FAILED"
              : result.exitCode === 0
                ? undefined
                : "COMMAND_FAILED");
          if (code) {
            rejectPromise(
              new CommandExecutionError({
                ...result,
                code,
                executable: spec.executable,
              }),
            );
            return;
          }
          resolvePromise(result);
        });
      });
    },
  };
}
