import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import {
  cliCompatibility,
  cliExecutionEnvironment,
  cliExecutionPath,
  cliProcessInvocation,
  cliSearchDirectories,
  detectCli,
  parseCliVersion,
  resolveExecutable,
} from "./cli-capabilities.js";

const execFileAsync = promisify(execFile);

describe("cross-platform CLI capability detection", () => {
  it("uses PATHEXT for native Windows resolution", async () => {
    const found = await resolveExecutable("codex", {
      platform: "win32",
      env: { PATH: "C:\\Tools", PATHEXT: ".EXE;.CMD" },
      canAccess: async (candidate) => {
        if (!candidate.endsWith("codex.EXE")) throw new Error("missing");
      },
    });
    expect(found).toBe("C:\\Tools\\codex.EXE");
  });

  it("finds user-local CLIs with a Finder-style PATH", async () => {
    const accessible = new Set([
      "/Users/test/.local/bin/claude",
      "/Users/test/.local/bin/codex",
    ]);
    const canAccess = async (candidate: string) => {
      if (!accessible.has(candidate)) throw new Error("missing");
    };
    const env = { PATH: "/usr/bin:/bin", HOME: "/Users/test" };
    await expect(
      resolveExecutable("claude", { platform: "darwin", env, canAccess }),
    ).resolves.toBe("/Users/test/.local/bin/claude");
    await expect(
      resolveExecutable("codex", { platform: "darwin", env, canAccess }),
    ).resolves.toBe("/Users/test/.local/bin/codex");
    await expect(
      resolveExecutable("codex", {
        platform: "darwin",
        env,
        canAccess: async (candidate) => {
          if (candidate !== "/Applications/ChatGPT.app/Contents/Resources/codex")
            throw new Error("missing");
        },
      }),
    ).resolves.toBe("/Applications/ChatGPT.app/Contents/Resources/codex");
    expect(cliSearchDirectories(env, "darwin")).toContain("/opt/homebrew/bin");
  });

  it("finds a freshly installed native Grok Build without a PATH refresh", async () => {
    const expected = "C:\\Users\\test\\.grok\\bin\\grok.EXE";
    const found = await resolveExecutable("grok", {
      platform: "win32",
      env: {
        PATH: "C:\\Windows\\System32",
        PATHEXT: ".EXE;.CMD",
        USERPROFILE: "C:\\Users\\test",
      },
      canAccess: async (candidate) => {
        if (candidate !== expected) throw new Error("missing");
      },
    });
    expect(found).toBe(expected);
    expect(
      cliSearchDirectories({ PATH: "/usr/bin", HOME: "/Users/test" }, "darwin"),
    ).toContain("/Users/test/.grok/bin");
    expect(
      cliSearchDirectories({ PATH: "/usr/bin", HOME: "/home/test" }, "linux"),
    ).toContain("/home/test/.grok/bin");
  });

  it("builds a child PATH that keeps the resolved executable and its runtime dependencies reachable", () => {
    expect(
      cliExecutionPath(
        "/Users/test/.local/bin/claude",
        { PATH: "/usr/bin", HOME: "/Users/test" },
        "darwin",
      ).split(":"),
    ).toEqual(
      expect.arrayContaining([
        "/Users/test/.local/bin",
        "/usr/bin",
        "/opt/homebrew/bin",
      ]),
    );
  });

  it("preserves only the Windows runtime variables required by native CLI children", () => {
    const value = cliExecutionEnvironment(
      "C:\\Tools\\codex.cmd",
      {
        PATH: "C:\\Windows\\System32",
        USERPROFILE: "C:\\Users\\test",
        USERNAME: "test",
        SystemRoot: "C:\\Windows",
        APPDATA: "C:\\Users\\test\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        TEMP: "C:\\Temp",
        TMP: "C:\\Temp",
        COMSPEC: "C:\\Windows\\System32\\cmd.exe",
        SECRET_TOKEN: "no",
      },
      "win32",
    );
    expect(value).toMatchObject({
      HOME: "C:\\Users\\test",
      USER: "test",
      USERPROFILE: "C:\\Users\\test",
      SystemRoot: "C:\\Windows",
      APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      TEMP: "C:\\Temp",
      TMP: "C:\\Temp",
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
    });
    expect(value).not.toHaveProperty("SECRET_TOKEN");
  });

  it("runs Windows npm shims through their package entrypoint without changing native or POSIX executables", async () => {
    await expect(
      cliProcessInvocation(
        "codex",
        "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd",
        ["--version"],
        {
          platform: "win32",
          nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
          canAccess: async () => undefined,
        },
      ),
    ).resolves.toEqual({
      executable: "C:\\Program Files\\nodejs\\node.exe",
      args: [
        "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
        "--version",
      ],
    });
    await expect(
      cliProcessInvocation("codex", "C:\\Tools\\codex.exe", ["--version"], {
        platform: "win32",
      }),
    ).resolves.toEqual({
      executable: "C:\\Tools\\codex.exe",
      args: ["--version"],
    });
    await expect(
      cliProcessInvocation("codex", "/opt/homebrew/bin/codex", ["--version"], {
        platform: "darwin",
      }),
    ).resolves.toEqual({
      executable: "/opt/homebrew/bin/codex",
      args: ["--version"],
    });
  });

  it("supports a project-local Windows npm .bin shim without executing the shim", async () => {
    const expected = "C:\\repo\\node_modules\\@openai\\codex\\bin\\codex.js";
    await expect(
      cliProcessInvocation(
        "codex",
        "C:\\repo\\node_modules\\.bin\\codex.cmd",
        ["--version"],
        {
          platform: "win32",
          nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
          canAccess: async (candidate) => {
            if (candidate !== expected) throw new Error("missing");
          },
        },
      ),
    ).resolves.toEqual({
      executable: "C:\\Program Files\\nodejs\\node.exe",
      args: [expected, "--version"],
    });
  });

  it.runIf(process.platform === "win32")(
    "preserves spaces and command metacharacters through a real Windows shim invocation",
    async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "waypoint cli shim ")),
        shim = path.join(root, "codex.cmd"),
        entrypoint = path.join(
          root,
          "node_modules",
          "@openai",
          "codex",
          "bin",
          "codex.js",
        ),
        dangerous = [
          "model&echo INJECTION",
          "pipe|more",
          "redirect>file",
          "<input",
          "caret^value",
          "percent%PATH%",
          "bang!",
        ];
      mkdirSync(path.dirname(entrypoint), { recursive: true });
      writeFileSync(shim, "@echo off\r\n");
      writeFileSync(
        entrypoint,
        "console.log(JSON.stringify(process.argv.slice(2)))\n",
      );
      try {
        const invocation = await cliProcessInvocation(
          "codex",
          shim,
          dangerous,
          { platform: "win32", nodeExecutable: process.execPath },
        );
        const { stdout } = await execFileAsync(
          invocation.executable,
          invocation.args,
          { shell: false },
        );
        expect(JSON.parse(stdout.trim())).toEqual(dangerous);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("executes the exact resolved path without re-resolving the name", async () => {
    const run = vi.fn(async () => ({ stdout: "codex-cli 1.2.3", stderr: "" }));
    const result = await detectCli("codex", {
      env: { PATH: "/trusted/bin" },
      platform: "darwin",
      canAccess: async () => undefined,
      run,
    });
    expect(run).toHaveBeenCalledWith("/trusted/bin/codex", ["--version"]);
    expect(result.available).toBe(true);
  });

  it("returns structured missing and malformed states", async () => {
    const missing = await detectCli("claude", {
      env: { PATH: "/none" },
      canAccess: async () => {
        throw new Error("missing");
      },
    });
    expect(missing).toMatchObject({
      available: false,
      error: expect.stringContaining("supported local install location"),
    });
    const malformed = await detectCli("claude", {
      env: { PATH: "/trusted" },
      canAccess: async () => undefined,
      run: async () => ({ stdout: "", stderr: "" }),
    });
    expect(malformed).toMatchObject({
      available: false,
      error: "CLI returned an empty version",
    });
  });

  it("surfaces timeout and execution failures without throwing", async () => {
    const result = await detectCli("codex", {
      env: { PATH: "/trusted" },
      canAccess: async () => undefined,
      run: async () => {
        throw new Error("timed out");
      },
    });
    expect(result).toMatchObject({ available: false, error: "timed out" });
  });
  it("parses decorated versions and returns actionable compatibility policy", () => {
    expect(parseCliVersion("codex-cli 0.146.0-alpha.9.2")).toEqual([0, 146, 0]);
    expect(cliCompatibility("codex", "codex-cli 0.146.0")).toEqual({
      compatible: true,
    });
    expect(cliCompatibility("codex", "codex-cli 0.149.0")).toEqual({
      compatible: true,
    });
    expect(
      cliCompatibility("codex", "codex-cli 0.146.0-alpha.9.2"),
    ).toMatchObject({
      compatible: false,
      error: expect.stringContaining("validated app-server protocols"),
    });
    expect(cliCompatibility("codex", "codex-cli 0.147.0")).toMatchObject({
      compatible: false,
      error: expect.stringContaining("validated app-server protocols"),
    });
    expect(cliCompatibility("codex", "codex-cli 0.149.0-beta.1")).toMatchObject({
      compatible: false,
      error: expect.stringContaining("validated app-server protocols"),
    });
    for (const unvalidated of [
      "codex-cli 0.149.0rc1",
      "codex-cli 0.149.0.1",
      "codex 0.149.0",
    ])
      expect(cliCompatibility("codex", unvalidated)).toMatchObject({
        compatible: false,
        error: expect.stringContaining("validated app-server protocols"),
      });
    expect(cliCompatibility("codex", "codex-cli 0.150.0")).toMatchObject({
      compatible: false,
      error: expect.stringContaining("validated app-server protocols"),
    });
    expect(cliCompatibility("claude", "2.1.220 (Claude Code)")).toEqual({
      compatible: true,
    });
    expect(cliCompatibility("claude", "2.1.219")).toMatchObject({
      compatible: false,
      error: expect.stringContaining("2.1.220 or newer"),
    });
    expect(cliCompatibility("grok", "grok 1.0.3 (abcdef) [stable]")).toEqual({
      compatible: true,
    });
    expect(cliCompatibility("grok", "grok 1.0.2")).toMatchObject({
      compatible: false,
      error: expect.stringContaining("1.0.3 or newer"),
    });
    expect(cliCompatibility("grok", "grok 2.0.0")).toMatchObject({
      compatible: false,
      error: expect.stringContaining("newer than Waypoint's validated range"),
    });
    expect(cliCompatibility("codex", "1.0.0")).toMatchObject({
      compatible: false,
      error: expect.stringContaining("newer than Waypoint's validated range"),
    });
    expect(cliCompatibility("codex", "development build")).toMatchObject({
      compatible: false,
      error: expect.stringContaining("Could not parse"),
    });
  });
});
