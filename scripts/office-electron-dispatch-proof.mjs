import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";

const projectRoot = path.resolve(import.meta.dirname, ".."),
  proofRoot = mkdtempSync(path.join(tmpdir(), "waypoint-office-electron-")),
  repositoryRoot = path.join(proofRoot, "repository"),
  userDataRoot = path.join(proofRoot, "user-data"),
  executablePath =
    process.platform === "win32"
      ? path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
      : process.platform === "darwin"
        ? path.join(
            projectRoot,
            "node_modules",
            "electron",
            "dist",
            "Electron.app",
            "Contents",
            "MacOS",
            "Electron",
          )
        : path.join(projectRoot, "node_modules", "electron", "dist", "electron");

mkdirSync(repositoryRoot);
let application, runId, workspaceId;
try {
  application = await electron.launch({
    executablePath,
    args: [projectRoot, `--user-data-dir=${userDataRoot}`],
    cwd: projectRoot,
    env: {
      ...process.env,
      USERPROFILE: proofRoot,
      CODEX_HOME:
        process.env.CODEX_HOME ??
        path.join(process.env.USERPROFILE ?? "", ".codex"),
    },
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => Boolean(window.waypoint));
  const workspace = await page.evaluate(() =>
    window.waypoint.createWorkspace("Office Electron proof"),
  );
  workspaceId = workspace.id;
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedPath],
    });
  }, repositoryRoot);
  const selected = await page.evaluate((id) =>
    window.waypoint.chooseWorkspaceExecutionRoot(id),
    workspaceId,
  );
  if (selected.workspace.executionRoot !== repositoryRoot)
    throw new Error("Isolated repository boundary was not selected");
  const setup = await page.evaluate(async (id) => ({
    capabilities: await window.waypoint.cliCapabilities(),
    profiles: await window.waypoint.listSecurityProfiles(id),
  }), workspaceId);
  const codex = setup.capabilities.find((item) => item.name === "codex"),
    profile = setup.profiles.find(
      (item) => item.approval !== "never" && item.filesystem === "read-only",
    );
  if (!codex?.available || codex.compatible === false)
    throw new Error("Codex is not available for the isolated runtime proof");
  if (!profile) throw new Error("A non-bypass read-only profile is unavailable");

  await page.reload();
  await page.getByRole("button", { name: /Command Center/ }).click();
  await page.getByRole("button", { name: "Select Office Manager" }).click();
  await page.getByRole("button", { name: "Begin a task" }).click();
  const objective = "Reply with exactly OFFICE_RUNTIME_OK and do not use tools.";
  await page.getByLabel("Objective").fill(objective);
  await page.getByLabel("Provider").selectOption("codex");
  await page.getByLabel("Authority profile").selectOption(profile.id);
  await page.getByRole("button", { name: "Review work order" }).click();
  const before = await page.evaluate((id) =>
    window.waypoint.listExecutions(id),
    workspaceId,
  );
  if (before.length !== 0)
    throw new Error("An execution existed before final confirmation");
  await page.getByRole("button", { name: "Confirm and dispatch" }).click();

  const deadline = Date.now() + 120_000;
  let run, chat;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(async (id) => ({
      runs: await window.waypoint.listExecutions(id),
      chats: await window.waypoint.listChats(id),
    }), workspaceId);
    run = snapshot.runs.find((item) => item.cli === "codex");
    if (run) {
      runId = String(run.id);
      chat = snapshot.chats.find((item) => item.id === run.chatId);
      if (["completed", "failed", "canceled", "timed_out"].includes(String(run.status)))
        break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!run || !chat) throw new Error("Confirmed work did not create a real run");
  if (chat.messages.find((message) => message.role === "user")?.body !== objective)
    throw new Error("The dispatched source brief changed");
  if (run.securityProfileId !== profile.id)
    throw new Error("The dispatched authority profile changed");
  if (run.status !== "completed")
    throw new Error(`Safe runtime task ended ${String(run.status)}`);
  const assistant = chat.messages.findLast(
    (message) => message.role === "assistant",
  );
  if (!assistant?.body.includes("OFFICE_RUNTIME_OK"))
    throw new Error("Safe runtime response was not observed");
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      workspace: workspace.name,
      repositoryBoundary: repositoryRoot,
      chatId: chat.id,
      runId,
      provider: run.cli,
      securityProfileId: run.securityProfileId,
      runStatus: run.status,
      exactBrief: true,
      responseObserved: true,
    })}\n`,
  );
} finally {
  if (application) {
    if (workspaceId && runId)
      await application
        .firstWindow()
        .then((page) =>
          page.evaluate(
            ({ workspaceId: id, runId: executionId }) =>
              window.waypoint.cancelExecution(executionId).catch(() => undefined),
            { workspaceId, runId },
          ),
        )
        .catch(() => undefined);
    await application.close().catch(() => undefined);
  }
  rmSync(proofRoot, { recursive: true, force: true });
}
