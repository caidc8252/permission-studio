import { describe, expect, it } from "vitest";

import { createGhClient } from "@/src/github/gh-client";
import {
  CommandExecutionError,
  type CommandResult,
  type CommandRunner,
  type CommandSpec,
} from "@/src/system/command-runner";

class FakeRunner implements CommandRunner {
  readonly calls: Array<[string, string[]]> = [];
  private readonly responses: Array<CommandResult | Error>;

  constructor(responses: Array<CommandResult | Error>) {
    this.responses = [...responses];
  }

  async run(spec: CommandSpec): Promise<CommandResult> {
    this.calls.push([spec.executable, [...spec.args]]);
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected command");
    if (response instanceof Error) throw response;
    return response;
  }
}

const ok = (stdout = ""): CommandResult => ({
  exitCode: 0,
  stdout,
  stderr: "",
  durationMs: 1,
});

const commandError = (code: "COMMAND_FAILED" | "COMMAND_START_FAILED"): CommandExecutionError =>
  new CommandExecutionError({
    code,
    executable: "gh",
    exitCode: code === "COMMAND_START_FAILED" ? -1 : 1,
    stdout: "",
    stderr: "sensitive details",
    durationMs: 1,
  });

describe("createGhClient", () => {
  it("checks auth, viewer identity, and exact repository access without reading a token", async () => {
    const runner = new FakeRunner([
      ok(),
      ok(JSON.stringify({ login: "caidc8252", id: 42 })),
      ok(
        JSON.stringify({
          nameWithOwner: "Newland-Payment-Technology-US-Co-Ltd/pep-webapp",
          isPrivate: true,
          viewerPermission: "ADMIN",
        }),
      ),
    ]);

    const result = await createGhClient(runner).preflight();

    expect(runner.calls).toEqual([
      ["gh", ["auth", "status", "--hostname", "github.com"]],
      ["gh", ["api", "user"]],
      [
        "gh",
        [
          "repo",
          "view",
          "Newland-Payment-Technology-US-Co-Ltd/pep-webapp",
          "--json",
          "nameWithOwner,isPrivate,viewerPermission",
        ],
      ],
    ]);
    expect(runner.calls.flat(2)).not.toContain("token");
    expect(result).toMatchObject({
      ready: true,
      authenticated: true,
      login: "caidc8252",
      repositoryAccessible: true,
      viewerPermission: "ADMIN",
      canWrite: true,
    });
    expect(result.viewer).toEqual({
      login: "caidc8252",
      id: 42,
      noreplyEmail: "42+caidc8252@users.noreply.github.com",
    });
  });

  it.each(["WRITE", "MAINTAIN", "ADMIN"])(
    "accepts %s as write-capable",
    async (viewerPermission) => {
      const runner = new FakeRunner([
        ok(),
        ok(JSON.stringify({ login: "writer", id: 7 })),
        ok(
          JSON.stringify({
            nameWithOwner: "Newland-Payment-Technology-US-Co-Ltd/pep-webapp",
            isPrivate: true,
            viewerPermission,
          }),
        ),
      ]);

      expect((await createGhClient(runner).preflight()).canWrite).toBe(true);
    },
  );

  it("reports read-only repository access without treating it as ready", async () => {
    const runner = new FakeRunner([
      ok(),
      ok(JSON.stringify({ login: "reader", id: 9 })),
      ok(
        JSON.stringify({
          nameWithOwner: "Newland-Payment-Technology-US-Co-Ltd/pep-webapp",
          isPrivate: true,
          viewerPermission: "READ",
        }),
      ),
    ]);

    expect(await createGhClient(runner).preflight()).toMatchObject({
      ready: false,
      authenticated: true,
      repositoryAccessible: true,
      canWrite: false,
      errorCode: "GH_REPOSITORY_WRITE_REQUIRED",
    });
  });

  it("maps missing gh and unauthenticated states without leaking stderr", async () => {
    const missing = await createGhClient(
      new FakeRunner([commandError("COMMAND_START_FAILED")]),
    ).preflight();
    const loggedOut = await createGhClient(
      new FakeRunner([commandError("COMMAND_FAILED")]),
    ).preflight();

    expect(missing).toEqual({
      ready: false,
      authenticated: false,
      repositoryAccessible: false,
      canWrite: false,
      errorCode: "GH_NOT_INSTALLED",
    });
    expect(loggedOut).toEqual({
      ready: false,
      authenticated: false,
      repositoryAccessible: false,
      canWrite: false,
      errorCode: "GH_NOT_AUTHENTICATED",
    });
    expect(JSON.stringify([missing, loggedOut])).not.toContain("sensitive details");
  });

  it("maps inaccessible repositories and malformed JSON to stable errors", async () => {
    const inaccessible = await createGhClient(
      new FakeRunner([
        ok(),
        ok(JSON.stringify({ login: "writer", id: 7 })),
        commandError("COMMAND_FAILED"),
      ]),
    ).preflight();
    const malformed = await createGhClient(new FakeRunner([ok(), ok("{not-json")])).preflight();

    expect(inaccessible).toMatchObject({
      ready: false,
      authenticated: true,
      repositoryAccessible: false,
      errorCode: "GH_REPOSITORY_INACCESSIBLE",
    });
    expect(malformed).toMatchObject({
      ready: false,
      authenticated: true,
      repositoryAccessible: false,
      errorCode: "GH_RESPONSE_INVALID",
    });
  });
});
