import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";

const projectRoot = path.resolve(import.meta.dirname, ".."),
  proofRoot = mkdtempSync(path.join(tmpdir(), "waypoint-office-navigation-")),
  repositoryRoot = path.join(proofRoot, "repository"),
  screenshotRoot = path.join(projectRoot, ".codex", "build-to-complete"),
  executablePath =
    process.platform === "win32"
      ? path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
      : process.platform === "darwin"
        ? path.join(projectRoot, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
        : path.join(projectRoot, "node_modules", "electron", "dist", "electron");

mkdirSync(repositoryRoot);
mkdirSync(screenshotRoot, { recursive: true });
let application;
try {
  application = await electron.launch({
    executablePath,
    args: [projectRoot],
    cwd: projectRoot,
    env: { ...process.env, USERPROFILE: proofRoot },
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => Boolean(window.waypoint));
  const workspace = await page.evaluate(() =>
    window.waypoint.createWorkspace("Office navigation proof"),
  );
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, repositoryRoot);
  await page.evaluate((id) => window.waypoint.chooseWorkspaceExecutionRoot(id), workspace.id);
  await page.evaluate(async (id) => {
    const chatId = await window.waypoint.createChat(id, "Preserved chat proof");
    await window.waypoint.addMessage(
      id,
      chatId,
      "user",
      "Existing chat remains available beside the Command Center.",
      [],
    );
    localStorage.setItem("waypoint.appearance.v1", "dark");
  }, workspace.id);
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 900 });
  const workspaceTools = page.getByRole("navigation", { name: "Workspace tools" });

  await workspaceTools.getByRole("button", { name: /Command Center/ }).click();
  await page.getByRole("button", { name: "Select Office Manager" }).click();
  await page.screenshot({
    path: path.join(screenshotRoot, "office-command-center-dark.png"),
  });
  await page.getByRole("button", { name: "Begin a task" }).click();
  await page
    .getByLabel("Objective")
    .fill("Polish the onboarding flow without changing existing chat behavior.");
  await page.getByRole("button", { name: "Review work order" }).click();
  await page.getByRole("button", { name: "Confirm and dispatch" }).waitFor();
  await page.screenshot({
    path: path.join(screenshotRoot, "office-manager-review-dark.png"),
  });
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();

  await workspaceTools.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await workspaceTools.getByRole("button", { name: /Command Center/ }).click();
  await page.locator(".office-command-center").waitFor();
  await page.getByRole("button", { name: /Preserved chat proof/ }).first().click();
  await page
    .getByLabel("Conversation", { exact: true })
    .getByText("Existing chat remains available beside the Command Center.", {
      exact: true,
    })
    .waitFor();
  await workspaceTools.getByRole("button", { name: /Command Center/ }).click();
  await page.getByRole("button", { name: "Close Command Center" }).click();
  if (await page.locator(".office-command-center").count())
    throw new Error("Command Center did not close");
  await workspaceTools.getByRole("button", { name: /Command Center/ }).click();
  if ((await page.getByRole("button", { name: "Close Command Center" }).count()) !== 1)
    throw new Error("Command Center did not reopen as one workspace tab");

  await page.evaluate(() => localStorage.setItem("waypoint.appearance.v1", "light"));
  await page.reload();
  await page.setViewportSize({ width: 680, height: 820 });
  if (!(await page.locator(".office-command-center").count()))
    await page
      .getByRole("navigation", { name: "Workspace tools" })
      .getByRole("button", { name: /Command Center/ })
      .evaluate((button) => button.click());
  await page.getByRole("button", { name: "Select Office Manager" }).waitFor();
  await page.screenshot({
    path: path.join(screenshotRoot, "office-command-center-light-narrow.png"),
    fullPage: true,
  });

  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      isolatedProfile: true,
      chatPreserved: true,
      settingsRoundTrip: true,
      closeReopen: true,
      darkScreenshot: path.join(screenshotRoot, "office-command-center-dark.png"),
      managerReviewScreenshot: path.join(
        screenshotRoot,
        "office-manager-review-dark.png",
      ),
      lightNarrowScreenshot: path.join(
        screenshotRoot,
        "office-command-center-light-narrow.png",
      ),
    })}\n`,
  );
} finally {
  await application?.close().catch(() => undefined);
  rmSync(proofRoot, { recursive: true, force: true });
}
