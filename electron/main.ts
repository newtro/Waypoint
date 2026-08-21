import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  Notification,
  protocol,
  safeStorage,
  screen,
  shell,
  systemPreferences,
} from "electron";
import type {
  Display,
  IpcMainInvokeEvent,
  NativeImage,
  WebContents,
} from "electron";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  accessSync,
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { WorkspaceStore } from "./core/store.js";
import {
  autoTitleMayStart,
  minimalTitlePrompt,
  resolveAutomaticTitle,
} from "./core/auto-chat-title.js";
import { canonicalExecutionText } from "./core/execution-output.js";
import { LocalOllamaEmbeddings } from "./core/ollama.js";
import {
  CHUNKING_POLICIES,
  chunkingDigest,
  storedChunkingProvenance,
} from "./core/embedding-benchmark.js";
import {
  CliWorkbench,
  type CliImageInput,
  type ExecutionEvent,
} from "./core/ai-workbench.js";
import {
  CodexAppServerWorkbench,
  type CodexApprovalRequest,
  type CodexProviderDecision,
} from "./core/codex-app-server.js";
import { ClaudeAgentWorkbench } from "./core/claude-agent-sdk.js";
import {
  cleanupStaleGrokAutomationDirectories,
  GrokAgentWorkbench,
} from "./core/grok-agent-acp.js";
import { auditableProviderDecision } from "./core/auditable-provider-decision.js";
import {
  ProviderDecisionGate,
  providerDecisionFingerprint,
} from "./core/provider-decision-gate.js";
import {
  cleanupRunScopedAttachmentDirectories,
  initializeRunScopedAttachmentOwnership,
  managedWorkspaceExecutionRoots,
  markRunScopedAttachmentDirectory,
} from "./core/run-scoped-attachment-cleanup.js";
import { canonicalWindowsUserData } from "./core/windows-canonical-profile.js";
import { detectCli } from "../spikes/cli-capabilities.js";
import {
  deleteWithExecutionCancellation,
  startDurableChild,
  validateOneChildDelegation,
} from "./core/execution-lifecycle.js";
import { finalizeExecution } from "./core/execution-finalization.js";
import { withCurrentDateTime } from "./core/prompt-context.js";
import {
  loadProductHelp,
  withProductHelp,
  type ProductHelpLibrary,
} from "./core/product-help.js";
import {
  WEBHOOK_CONNECTORS,
  assertAutomationProposalProvisionable,
  assertAutomationSkillVerified,
  validateAutomationProposal,
} from "./core/webhook-automations.js";
import { cleanupLegacyWindowsInstall } from "./core/legacy-windows-install.js";
import {
  automationProposalPreparedSummary,
  codexTurnCanBeSteered,
  extractAutomationProposalTool,
  withAutomationProposalTool,
} from "./core/automation-ai-tool.js";
import {
  connectorProvisioningPreview,
  provisionConnector,
} from "./core/connector-provisioning.js";
import { readBackup, writeAtomicBackup } from "./core/backup.js";
import { runBackupAdministration } from "./core/backup-administration-runner.js";
import { extractDocumentOffMain } from "./core/document-extraction-runner.js";
import {
  assertAttachmentExtractionDigest,
  assertPreparedAttachmentSources,
  CHAT_DOCUMENT_MEDIA,
  CHAT_IMAGE_MEDIA,
  providerAttachmentLabel,
  withChatAttachmentContext,
  withChatFileAttachmentContext,
  type PreparedAttachmentSource,
  type ProviderFileAttachment,
  type ProviderTextAttachment,
} from "./core/provider-attachment-context.js";
import {
  chunkExtractedText,
  DOCUMENT_CHUNKING_POLICY,
  type DocumentChunk,
} from "./core/document-ingestion.js";
import { exportDiagnosticsReport, runDiagnostics } from "./core/diagnostics.js";
import { sanitizeSyncStatus } from "./core/sync/sync-status.js";
import {
  ATTACHMENT_MEDIA_BY_EXTENSION,
  imageDimensions,
  readAndValidateAttachment,
} from "./core/chat-attachments.js";
import {
  isEffectivelyMaximized,
  restoreWindowState,
  type SavedWindowState,
  type WindowBounds,
} from "./core/window-state.js";
import { ProtectedSyncVault } from "./core/sync/protected-sync-vault.js";
import { DesktopSyncService } from "./core/sync/desktop-sync-service.js";
import { PeerHostRuntime } from "./core/sync/peer-host-runtime.js";
import { recordSyncActivityBestEffort } from "./core/activity-recording.js";
import { assertRoute, proposeRoute } from "./core/provider-routing.js";
import {
  assertChildAgainstParent,
  childContext,
  createChildTask,
  type ChildTaskManifest,
} from "./core/agent-policy.js";
import {
  createExecutionBudget,
  securityProfileDigest,
  serializeExecutionBudget,
} from "./core/execution-budget.js";
import {
  ToolGateway,
  discoverLocalCli,
  redactToolText,
  validatePolicy,
  type ToolGatewayPolicy,
  type ToolRequest,
  type ToolResult,
} from "./core/tool-gateway.js";
import {
  failureIdentity,
  localFailureContext,
  safeFailureNote,
  workspaceFailureKey,
} from "./core/tool-failure-learning.js";
import { ProtectedProviderVault } from "./core/protected-provider-vault.js";
import {
  FetchOpenRouterTransport,
  OpenRouterAgentClient,
  OpenRouterBudgetGate,
  OpenRouterClient,
  decideHostedRoute,
  openRouterCapability,
  selectOpenRouterModel,
  type OpenRouterImageInput,
  type OpenRouterSettings,
  type ProviderUsageReceipt,
} from "./core/openrouter-provider.js";
import {
  OPENROUTER_AUTOMATION_PROPOSAL_TOOL,
  openRouterToolApprovalKind,
  openRouterToolNeedsApproval,
  openRouterToolRequest,
  openRouterTools,
} from "./core/openrouter-tool-gateway.js";
import { VoiceRuntimeRegistry } from "./core/voice-runtime.js";
import {
  FastLocalSpeechProcessAdapter,
  FastLocalTranscriptionProcessAdapter,
  type FastSpeechMetric,
} from "./core/fast-local-speech.js";
import {
  macActivityCaptureReadiness,
  validateActivityCapturePolicy,
} from "./core/activity-capture.js";
import { VoiceOperationRegistry } from "./core/voice-turn-manager.js";
import {
  fixtureVoiceMetrics,
  VoicePackManager,
  type VoiceEngineId,
} from "./core/voice-engine.js";
import { remotePolicyDigest } from "./core/cross-device-control.js";
import {
  installedCliModelCatalog,
  shutdownInstalledCliModelCatalog,
} from "./core/provider-model-catalog.js";
import {
  isThinkingEffort,
  localProviderAllowsThinking,
  type ThinkingEffort,
} from "../src/model-thinking.js";
import { openRouterModelThinking } from "./core/openrouter-model-catalog.js";
import {
  AGENT_BROWSER_VERSION,
  verifyBrowserClosure,
} from "./core/agent-browser.js";
import { ProtectedWebSearchVault } from "./core/protected-web-search-vault.js";
import { ControlledWebTools } from "./core/web-tools.js";
import {
  browserCandidates,
  selectedBrowser,
} from "./core/browser-discovery.js";
import { InAppBrowserController } from "./core/in-app-browser.js";
import { snapshotBrowserProfile } from "./core/browser-profile-snapshot.js";
import {
  assertVisibleCapturePixels,
  captureReadiness,
  captureVisibilityStrategy,
  quickCaptureCropBounds,
  validateCaptureSettings,
  type CaptureMode,
  type CaptureSettings,
} from "./core/manual-screen-capture.js";
import {
  probeMeetingMediaDecoder,
  transcribeMeetingFile,
} from "./core/meeting-transcription-runner.js";
import {
  meetingPlaybackCachePath,
  prepareSeekableMeetingPlayback,
  removeSeekableMeetingPlayback,
} from "./core/meeting-playback-cache.js";

// Contained browser traffic must not bypass the audited HTTPS CONNECT gate over UDP/QUIC.
app.commandLine.appendSwitch(
  "force-webrtc-ip-handling-policy",
  "disable_non_proxied_udp",
);
app.commandLine.appendSwitch("disable-quic");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "waypoint-media",
    privileges: { standard: true, secure: true, stream: true },
  },
]);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let store: WorkspaceStore;
let syncService: DesktopSyncService;
let productHelpLibrary: ProductHelpLibrary | undefined;
const meetingPlaybackGrants = new Map<
  string,
  {
    path: string;
    mediaType: string;
    bytes: number;
    expiresAt: number;
  }
>();
let meetingMediaDecoderProbe:
  ReturnType<typeof probeMeetingMediaDecoder> | undefined;
let meetingPlaybackCacheRoot = "";
const meetingPlaybackPreparations = new Map<string, Promise<string>>();

async function meetingPlaybackPath(audio: {
  path: string;
  mediaType: string;
  sha256: string;
}): Promise<string> {
  const existing = meetingPlaybackPreparations.get(audio.sha256);
  if (existing) return existing;
  const preparation = (async () => {
    const decoder = await (meetingMediaDecoderProbe ??=
      probeMeetingMediaDecoder());
    return (
      await prepareSeekableMeetingPlayback({
        sourcePath: audio.path,
        sourceSha256: audio.sha256,
        mediaType: audio.mediaType,
        cacheRoot: meetingPlaybackCacheRoot,
        decoderCommand: decoder.command,
      })
    ).path;
  })();
  meetingPlaybackPreparations.set(audio.sha256, preparation);
  try {
    return await preparation;
  } finally {
    meetingPlaybackPreparations.delete(audio.sha256);
  }
}

function registerMeetingPlaybackProtocol(): void {
  protocol.handle("waypoint-media", (request) => {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405 });
    const url = new URL(request.url),
      token = url.hostname,
      grant = meetingPlaybackGrants.get(token);
    if (!grant || grant.expiresAt < Date.now()) {
      meetingPlaybackGrants.delete(token);
      return new Response(null, { status: 404 });
    }
    let fileBytes: number;
    try {
      fileBytes = statSync(grant.path).size;
    } catch {
      meetingPlaybackGrants.delete(token);
      return new Response(null, { status: 404 });
    }
    if (fileBytes !== grant.bytes) return new Response(null, { status: 409 });
    const range = request.headers.get("range"),
      match = range?.match(/^bytes=(\d+)-(\d*)$/);
    let start = 0,
      end = fileBytes - 1,
      status = 200;
    if (range) {
      if (!match) return new Response(null, { status: 416 });
      start = Number(match[1]);
      end = match[2]
        ? Math.min(Number(match[2]), fileBytes - 1)
        : fileBytes - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= fileBytes
      )
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileBytes}` },
        });
      status = 206;
    }
    const length = end - start + 1,
      headers: Record<string, string> = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(length),
        "Content-Type": grant.mediaType,
      };
    if (status === 206)
      headers["Content-Range"] = `bytes ${start}-${end}/${fileBytes}`;
    if (request.method === "HEAD")
      return new Response(null, { status, headers });
    return new Response(
      Readable.toWeb(
        createReadStream(grant.path, { start, end }),
      ) as ReadableStream,
      { status, headers },
    );
  });
}
async function prepareAutomationProposal(
  workspaceId: string,
  chatId: string | undefined,
  value: unknown,
  verifiedSkill?: { provider: "codex" | "claude" | "grok"; identifier: string },
) {
  let definition = validateAutomationProposal(value);
  assertAutomationSkillVerified(definition, verifiedSkill);
  const sync = syncService.status(workspaceId),
    delivery = sync.configured
      ? syncService.planWebhookChannel(
          workspaceId,
          definition.trigger.connectorId,
        )
      : { reachability: "not_configured" as const };
  definition = validateAutomationProposal({ ...definition, delivery });
  assertAutomationProposalProvisionable(definition);
  definition = validateAutomationProposal({
    ...definition,
    provisioning: {
      ...definition.provisioning,
      commandPreview: connectorProvisioningPreview(definition),
    },
  });
  const proposal = store.createAutomationProposal(
    workspaceId,
    chatId,
    definition,
  );
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send("waypoint:automation-proposal-created", {
      workspaceId,
      chatId,
      proposalId: proposal.id,
    });
  return proposal;
}
let syncVault: ProtectedSyncVault;
let peerHostRuntime: PeerHostRuntime;
const activeSyncRuns = new Set<string>();
const activeWebhookRuns = new Set<string>();
const syncAbort = new AbortController(),
  providerModelCatalogAbort = new AbortController();
let trustedSenderId: number | undefined;
const pendingManualCaptures = new Map<
  string,
  {
    workspaceId: string;
    senderId: number;
    sourceId: string;
    sourceName: string;
    mode: CaptureMode;
    width: number;
    height: number;
    expiresAt: number;
  }
>();
const pendingCaptureVisibilityAcks = new Map<
  string,
  {
    senderId: number;
    hidden: boolean;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

ipcMain.on(
  "waypoint:screen-capture-visibility-ack",
  (event, input: unknown) => {
    const value = input as Record<string, unknown>,
      token = typeof value?.token === "string" ? value.token : "",
      hidden = value?.hidden;
    const pending = pendingCaptureVisibilityAcks.get(token);
    if (
      !pending ||
      pending.senderId !== event.sender.id ||
      pending.hidden !== hidden
    )
      return;
    clearTimeout(pending.timer);
    pendingCaptureVisibilityAcks.delete(token);
    pending.resolve();
  },
);

function setCaptureOverlayVisibility(
  sender: WebContents,
  hidden: boolean,
): Promise<void> {
  const token = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCaptureVisibilityAcks.delete(token);
      reject(new Error("Capture interface did not become ready. Try again."));
    }, 2_000);
    pendingCaptureVisibilityAcks.set(token, {
      senderId: sender.id,
      hidden,
      resolve,
      timer,
    });
    sender.send("waypoint:screen-capture-visibility", { token, hidden });
  });
}
let captureShortcutState = {
  registered: false,
  shortcut: "",
  reason: "Capture shortcut has not been registered yet",
};
let captureShortcutSuspended = false;
let quickCaptureActive = false;
const pendingQuickCaptures = new Map<
  string,
  {
    window: BrowserWindow;
    workspaceId: string;
    display: Display;
    image: NativeImage;
    sourceId: string;
    sourceName: string;
  }
>();

function captureWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(
    (item) =>
      !item.isDestroyed() &&
      ![...pendingQuickCaptures.values()].some(
        (pending) => pending.window === item,
      ),
  );
}

function quickCaptureNotice(
  status: "completed" | "failed" | "canceled",
  message: string,
  captureId?: string,
): void {
  captureWindow()?.webContents.send("waypoint:screen-capture-completed", {
    status,
    message,
    captureId,
  });
  if (status !== "canceled" && Notification.isSupported())
    new Notification({
      title: "Waypoint screen capture",
      body: message,
      silent: true,
    }).show();
}

function saveQuickCapture(
  workspaceId: string,
  mode: CaptureMode,
  sourceId: string,
  sourceName: string,
  image: NativeImage,
) {
  const size = image.getSize();
  assertVisibleCapturePixels(image.toBitmap(), size.width, size.height);
  const capture = store.createScreenCapture(
    workspaceId,
    {
      title: `Quick capture · ${sourceName}`,
      mode,
      sourceId,
      sourceName,
      capturedAt: new Date().toISOString(),
      width: size.width,
      height: size.height,
    },
    image.toPNG(),
  );
  clipboard.writeImage(image);
  quickCaptureNotice(
    "completed",
    "Captured and copied to the clipboard.",
    capture.id,
  );
  return capture;
}

async function displayCapture(
  display: Display,
): Promise<{ image: NativeImage; sourceId: string; sourceName: string }> {
  const width = Math.max(
      1,
      Math.round(display.bounds.width * display.scaleFactor),
    ),
    height = Math.max(
      1,
      Math.round(display.bounds.height * display.scaleFactor),
    ),
    sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    }),
    source =
      sources.find((item) => item.display_id === String(display.id)) ??
      sources[0];
  if (!source || source.thumbnail.isEmpty())
    throw new Error("The display could not be captured.");
  return {
    image: source.thumbnail,
    sourceId: source.id,
    sourceName: source.name || `Display ${display.id}`,
  };
}

async function foregroundWindowTitle(): Promise<string> {
  if (process.platform !== "win32")
    throw new Error(
      "Quick active-window capture is currently available on Windows.",
    );
  const script =
    '$sig=\'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);\'; Add-Type -MemberDefinition $sig -Name Native -Namespace Waypoint; $h=[Waypoint.Native]::GetForegroundWindow(); $b=New-Object System.Text.StringBuilder 1024; [void][Waypoint.Native]::GetWindowText($h,$b,$b.Capacity); [Console]::Write($b.ToString())';
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: 2_000, windowsHide: true, maxBuffer: 8_192 },
  );
  const title = stdout.trim();
  if (!title || title === "Waypoint")
    throw new Error("No external active window is available to capture.");
  return title;
}

async function activeWindowCapture(): Promise<{
  image: NativeImage;
  sourceId: string;
  sourceName: string;
}> {
  const title = await foregroundWindowTitle(),
    sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 4096, height: 4096 },
      fetchWindowIcons: false,
    }),
    normalized = title.toLocaleLowerCase(),
    source =
      sources.find((item) => item.name.toLocaleLowerCase() === normalized) ??
      sources.find(
        (item) =>
          normalized.includes(item.name.toLocaleLowerCase()) ||
          item.name.toLocaleLowerCase().includes(normalized),
      );
  if (!source || source.thumbnail.isEmpty())
    throw new Error(
      `The active window “${title}” could not be matched. Try Guided mode.`,
    );
  return {
    image: source.thumbnail,
    sourceId: source.id,
    sourceName: source.name,
  };
}

function quickCaptureOverlayHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;user-select:none}
    body{cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Cpath d='M24 3v42M3 24h42' stroke='white' stroke-width='3'/%3E%3Cpath d='M24 3v42M3 24h42' stroke='%231d2821' stroke-width='1'/%3E%3C/svg%3E") 24 24,crosshair}
    #shade{position:fixed;inset:0;background:rgba(15,20,17,.28)}
    #selection{display:none;position:fixed;border:2px solid white;outline:1px solid rgba(20,30,24,.72);box-shadow:0 0 0 100vmax rgba(8,12,10,.48);background:rgba(255,255,255,.04)}
  </style></head><body><div id="shade"></div><div id="selection"></div><script>
    const box=document.getElementById('selection'),shade=document.getElementById('shade');let start;
    const draw=(x,y)=>{const left=Math.min(start.x,x),top=Math.min(start.y,y),width=Math.abs(x-start.x),height=Math.abs(y-start.y);box.style.cssText='display:block;left:'+left+'px;top:'+top+'px;width:'+width+'px;height:'+height+'px';return{x:left,y:top,width,height}};
    addEventListener('pointerdown',event=>{if(event.button!==0)return;start={x:event.clientX,y:event.clientY};shade.style.display='none';draw(event.clientX,event.clientY)});
    addEventListener('pointermove',event=>{if(start)draw(event.clientX,event.clientY)});
    addEventListener('pointerup',event=>{if(!start)return;const bounds=draw(event.clientX,event.clientY);if(bounds.width>=4&&bounds.height>=4)window.quickCapture.select(bounds);else{start=undefined;box.style.display='none';shade.style.display='block'}});
    addEventListener('keydown',event=>{if(event.key==='Escape')window.quickCapture.cancel()});
    addEventListener('contextmenu',event=>{event.preventDefault();window.quickCapture.cancel()});
  </script></body></html>`;
}

async function startQuickCapture(
  workspaceId: string,
  settings: CaptureSettings,
): Promise<void> {
  if (quickCaptureActive) return;
  quickCaptureActive = true;
  try {
    if (settings.mode === "window") {
      const capture = await activeWindowCapture();
      saveQuickCapture(
        workspaceId,
        "window",
        capture.sourceId,
        capture.sourceName,
        capture.image,
      );
      quickCaptureActive = false;
      return;
    }
    const display = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      ),
      capture = await displayCapture(display);
    if (settings.mode === "display") {
      saveQuickCapture(
        workspaceId,
        "display",
        capture.sourceId,
        capture.sourceName,
        capture.image,
      );
      quickCaptureActive = false;
      return;
    }
    const token = randomUUID(),
      overlay = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        fullscreenable: false,
        show: false,
        webPreferences: {
          preload: path.join(currentDirectory, "quick-capture-preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          additionalArguments: [`--quick-capture-token=${token}`],
        },
      });
    pendingQuickCaptures.set(token, {
      window: overlay,
      workspaceId,
      display,
      image: capture.image,
      sourceId: capture.sourceId,
      sourceName: capture.sourceName,
    });
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.on("closed", () => {
      pendingQuickCaptures.delete(token);
      quickCaptureActive = false;
    });
    await overlay.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(quickCaptureOverlayHtml())}`,
    );
    overlay.show();
    overlay.focus();
  } catch (error) {
    quickCaptureActive = false;
    quickCaptureNotice(
      "failed",
      error instanceof Error ? error.message : "Quick capture failed.",
    );
  }
}

ipcMain.on("waypoint:quick-capture-select", (event, input: unknown) => {
  const value = input as Record<string, unknown>,
    token = typeof value?.token === "string" ? value.token : "",
    pending = pendingQuickCaptures.get(token);
  if (!pending || pending.window.webContents.id !== event.sender.id) return;
  try {
    const selection = value.bounds as {
        x: number;
        y: number;
        width: number;
        height: number;
      },
      crop = quickCaptureCropBounds(
        selection,
        pending.display.bounds,
        pending.image.getSize(),
      ),
      image = pending.image.crop(crop);
    saveQuickCapture(
      pending.workspaceId,
      "region",
      pending.sourceId,
      `${pending.sourceName} region`,
      image,
    );
  } catch (error) {
    quickCaptureNotice(
      "failed",
      error instanceof Error ? error.message : "Region capture failed.",
    );
  } finally {
    pending.window.destroy();
  }
});

ipcMain.on("waypoint:quick-capture-cancel", (event, input: unknown) => {
  const token =
      typeof (input as Record<string, unknown>)?.token === "string"
        ? String((input as Record<string, unknown>).token)
        : "",
    pending = pendingQuickCaptures.get(token);
  if (!pending || pending.window.webContents.id !== event.sender.id) return;
  quickCaptureNotice("canceled", "Quick capture canceled.");
  pending.window.destroy();
});

function registerCaptureShortcut(
  workspaceId: string,
  settings: CaptureSettings,
): boolean {
  if (captureShortcutState.shortcut)
    globalShortcut.unregister(captureShortcutState.shortcut);
  if (captureShortcutSuspended) {
    captureShortcutState = {
      registered: false,
      shortcut: settings.shortcut,
      reason: "Shortcut paused while recording a replacement",
    };
    return false;
  }
  const registered = globalShortcut.register(settings.shortcut, () => {
    if (settings.workflow === "quick") {
      void startQuickCapture(workspaceId, settings);
      return;
    }
    const window = captureWindow();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      window.webContents.send("waypoint:screen-capture-request");
    }
  });
  captureShortcutState = {
    registered,
    shortcut: settings.shortcut,
    reason: registered
      ? "Global screenshot shortcut ready"
      : "The shortcut is owned by macOS, Windows, or another application. Choose a different shortcut in Settings.",
  };
  return registered;
}
let trustedRendererUrl: string | undefined;
const embeddings = new LocalOllamaEmbeddings();
const activeDocumentIndexes = new Set<string>();
const activeChunkingProvenance = storedChunkingProvenance(CHUNKING_POLICIES[0]);
const documentChunkingDigest = chunkingDigest(DOCUMENT_CHUNKING_POLICY);
const workbench = new CliWorkbench();
const codexWorkbench = new CodexAppServerWorkbench();
const claudeWorkbench = new ClaudeAgentWorkbench();
const grokWorkbench = new GrokAgentWorkbench();
const activeCodexChats = new Map<
  string,
  {
    runId: string;
    profileId: string;
    model?: string;
    reasoningEffort?: import("../src/model-thinking.js").ThinkingEffort;
  }
>();
const deletingChats = new Set<string>();
const chatLifecycleKey = (workspaceId: string, chatId: string) =>
  `${workspaceId}:${chatId}`;
function assertChatMayStart(workspaceId: string, chatId: string): void {
  if (deletingChats.has(chatLifecycleKey(workspaceId, chatId)))
    throw new Error("This chat is being deleted and cannot start new AI work");
}
let toolGateway: ToolGateway;
let toolFailureFingerprintKey: Buffer;
let providerVault: ProtectedProviderVault;
let webSearchVault: ProtectedWebSearchVault;
const controlledWebTools = new ControlledWebTools();
const openRouterTransport = new FetchOpenRouterTransport(),
  openRouterClient = new OpenRouterClient(openRouterTransport),
  openRouterAgentClient = new OpenRouterAgentClient(openRouterTransport),
  openRouterBudget = new OpenRouterBudgetGate(),
  activeHostedRuns = new Map<
    string,
    {
      workspaceId: string;
      chatId: string;
      controller: AbortController;
      toolRunIds: Set<string>;
      completion?: Promise<void>;
    }
  >();
async function cancelHostedChatRuns(
  workspaceId: string,
  chatId: string,
): Promise<void> {
  const matches = [...activeHostedRuns.values()].filter(
    (run) => run.workspaceId === workspaceId && run.chatId === chatId,
  );
  for (const run of matches) {
    run.controller.abort();
    for (const toolRunId of run.toolRunIds)
      toolGateway.cancel(workspaceId, toolRunId);
  }
  await Promise.allSettled(
    matches.map((run) => run.completion ?? Promise.resolve()),
  );
  if (
    [...activeHostedRuns.values()].some(
      (run) => run.workspaceId === workspaceId && run.chatId === chatId,
    )
  )
    throw new Error(
      "The active hosted AI run could not be stopped, so the chat was not deleted",
    );
}
const providerDecisionResolvers = new Map<
    string,
    (input: {
      status: "accepted" | "accepted_session" | "declined" | "canceled";
      decision: Record<string, unknown>;
    }) => Promise<void>
  >(),
  providerDecisionGate = new ProviderDecisionGate();
function awaitProviderDecision(
  input: {
    workspaceId: string;
    chatId: string;
    executionId: string;
    provider: "codex" | "claude" | "grok" | "openrouter";
    request: CodexApprovalRequest;
  },
  signal: AbortSignal,
): Promise<CodexProviderDecision> {
  if (signal.aborted)
    return Promise.resolve({
      status: "canceled",
      decision: { reason: "execution_canceled" },
    });
  const durableRequestId = `${input.provider}:${input.executionId}:${input.request.providerRequestId}`;
  const fingerprint = providerDecisionFingerprint({
    provider: input.provider,
    kind: input.request.kind,
    title: input.request.title,
    detail: input.request.detail,
    options: input.request.options,
  });
  return providerDecisionGate.wait(
    input.executionId,
    durableRequestId,
    fingerprint,
    () => {
      const stored = store.createProviderRequest({
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        executionId: input.executionId,
        provider: input.provider,
        providerRequestId: input.request.providerRequestId,
        kind: input.request.kind,
        title: input.request.title,
        detail: input.request.detail,
        options: input.request.options,
      });
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value: CodexProviderDecision) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          providerDecisionResolvers.delete(stored!.id);
          resolve(value);
        };
        const onAbort = () =>
          finish({
            status: "canceled",
            decision: { reason: "execution_canceled" },
          });
        signal.addEventListener("abort", onAbort, { once: true });
        providerDecisionResolvers.set(stored!.id, async (value) =>
          finish(value),
        );
      });
    },
  );
}
const activeAutoTitles = new Map<
    string,
    { workspaceId: string; cancel: () => void }
  >(),
  activeAutoTitleTasks = new Set<Promise<void>>(),
  execFileAsync = promisify(execFile);
function startAutomaticChatTitle(
  workspaceId: string,
  chatId: string,
  user: string,
): void {
  const task = generateAutomaticChatTitle(workspaceId, chatId, user);
  activeAutoTitleTasks.add(task);
  void task.finally(() => activeAutoTitleTasks.delete(task));
}

async function generateAutomaticChatTitle(
  workspaceId: string,
  chatId: string,
  user: string,
): Promise<void> {
  if (
    !autoTitleMayStart(store.toolGatewaySettings(workspaceId).stopped) ||
    activeAutoTitles.has(chatId) ||
    !store.claimAutoTitle(workspaceId, chatId)
  )
    return;
  const prompt = minimalTitlePrompt(user),
    controller = new AbortController();
  let userCanceled = false;
  activeAutoTitles.set(chatId, {
    workspaceId,
    cancel: () => {
      userCanceled = true;
      controller.abort();
    },
  });
  try {
    const [claude, grok] = await Promise.all([
        detectCli("claude"),
        detectCli("grok"),
      ]),
      root = store
        .listWorkspaces()
        .find((item) => item.id === workspaceId)?.localPath;
    let claudeLane:
      (() => Promise<{ text: string; model: string }>) | undefined;
    if (
      claude.available &&
      claude.compatible !== false &&
      claude.executable &&
      root
    )
      try {
        const help = await execFileAsync(claude.executable, ["--help"], {
          timeout: 2_000,
          maxBuffer: 512_000,
          encoding: "utf8",
        });
        if (/--model[\s\S]{0,240}'fable'/.test(String(help.stdout)))
          claudeLane = async () => {
            const titleWorkbench = new CliWorkbench(),
              events: Array<Record<string, unknown>> = [],
              running = await titleWorkbench.start(
                `title-${chatId}`,
                {
                  cli: "claude",
                  prompt,
                  workspaceRoot: root,
                  profile: {
                    id: "auto-title-v1",
                    name: "Auto title — no tools",
                    roots: [root],
                    filesystem: "read-only",
                    network: "provider-only",
                    tools: [],
                    maxDurationMs: 0,
                    maxConcurrency: 1,
                    approval: "always",
                    peerEligible: false,
                    secretNames: [],
                  },
                  model: "fable",
                  executable: claude.executable!,
                  version: claude.version,
                },
                (event) => events.push(event),
              );
            controller.signal.addEventListener(
              "abort",
              () => running.cancel(),
              { once: true },
            );
            const terminal = await running.completion;
            if (terminal.status !== "completed")
              throw new Error(`claude_title_${terminal.status}`);
            return {
              text: canonicalExecutionText("claude", events, 256),
              model: "fable",
            };
          };
      } catch {
        /* Installed CLI does not truthfully advertise the lightweight alias. */
      }
    let grokLane: (() => Promise<{ text: string; model: string }>) | undefined;
    if (grok.available && grok.compatible !== false && grok.executable && root)
      grokLane = async () => {
        const events: ExecutionEvent[] = [],
          running = await grokWorkbench.start(
            `title-grok-${chatId}`,
            {
              cli: "grok",
              prompt,
              workspaceRoot: root,
              profile: {
                id: "auto-title-grok-v1",
                name: "Auto title · Grok · no tools",
                roots: [root],
                filesystem: "read-only",
                network: "provider-only",
                tools: [],
                maxDurationMs: 0,
                maxConcurrency: 1,
                approval: "always",
                peerEligible: false,
                secretNames: [],
              },
              executable: grok.executable,
              version: grok.version,
              isolatedNoTools: true,
              onSession: () => undefined,
              onApproval: async () => ({
                status: "declined",
                decision: { reason: "automatic_title_has_no_tools" },
              }),
            },
            (event) => events.push(event),
          );
        controller.signal.addEventListener("abort", () => running.cancel(), {
          once: true,
        });
        const terminal = await running.completion;
        if (terminal.status !== "completed")
          throw new Error(`grok_title_${terminal.status}`);
        return {
          text: canonicalExecutionText("grok", events, 256),
          model: "CLI default",
        };
      };
    let openrouterLane:
      (() => Promise<{ text: string; model: string }>) | undefined;
    try {
      const settings = store.openRouterSettings(),
        usage = store.providerUsage(),
        key = providerVault.getKey(),
        bounded = { ...settings, perRequestCapMicros: 10_000 };
      if (openRouterCapability(bounded, true, usage.summary).available)
        openrouterLane = async () => {
          const model = "openai/gpt-4.1-nano",
            release = openRouterBudget.reserve(bounded, usage.summary);
          try {
            const result = await openRouterClient.run({
              workspaceId,
              role: "everyday",
              model,
              prompt,
              apiKey: key,
              signal: controller.signal,
              requestCapMicros: 10_000,
            });
            store.saveProviderUsage(result.receipt);
            return { text: result.text, model };
          } catch (error) {
            const receipt = (error as { receipt?: ProviderUsageReceipt })
              .receipt;
            if (receipt) store.saveProviderUsage(receipt);
            throw error;
          } finally {
            release();
          }
        };
    } catch {
      /* Protected key/provider/cap unavailable. */
    }
    const result = await resolveAutomaticTitle({
      user,
      signal: controller.signal,
      claude: claudeLane,
      grok: grokLane,
      openrouter: openrouterLane,
      observe: (lane, outcome) =>
        store.recordAutoTitleAttempt(workspaceId, chatId, lane, outcome),
    });
    if (!userCanceled)
      store.completeAutoTitle(
        workspaceId,
        chatId,
        result.title,
        result.lane,
        result.model,
        result.reason,
      );
  } finally {
    store.releaseAutoTitle(workspaceId, chatId);
    activeAutoTitles.delete(chatId);
  }
}
let voiceRuntime: VoiceRuntimeRegistry,
  voicePacks: VoicePackManager,
  fastVoiceSpeech: FastLocalSpeechProcessAdapter,
  fastVoiceTranscription: FastLocalTranscriptionProcessAdapter,
  meetingTranscription: FastLocalTranscriptionProcessAdapter,
  fastVoiceMetric: FastSpeechMetric | undefined,
  fastInterruptionMs: number | undefined,
  fastVoicePackageBytes = 0;
const voiceStopRequests = new Map<string, number>(),
  voiceOperations = new VoiceOperationRegistry(),
  meetingTranscriptionRuns = new Map<
    string,
    {
      workspaceId: string;
      meetingId: string;
      nextIndex: number;
      parts: string[];
      characters: number;
      controller: AbortController;
      inFlight: boolean;
      baseline: string;
      stopTimer: NodeJS.Timeout;
    }
  >();
type SpeechResult = "completed" | "canceled" | "failed";
let voiceSpeechOwner:
  | {
      workspaceId: string;
      chatId: string;
      turnId: number;
      notify: (result: SpeechResult) => void;
    }
  | undefined;
function cancelMeetingRun(runId: string) {
  const run = meetingTranscriptionRuns.get(runId);
  if (!run) return false;
  run.controller.abort();
  clearInterval(run.stopTimer);
  run.parts.length = 0;
  meetingTranscriptionRuns.delete(runId);
  return true;
}
export function voiceFailureCode(error: unknown) {
  const value = error instanceof Error ? error.message : "";
  return [
    "voice_audio_size_invalid",
    "voice_audio_invalid",
    "voice_stt_unavailable",
    "voice_transcript_invalid",
    "voice_canceled",
    "voice_runtime_incompatible",
    "voice_global_stop_active",
  ].includes(value)
    ? value
    : "voice_runtime_failed";
}
function providerKeyConfigured() {
  try {
    providerVault.getKey();
    return true;
  } catch {
    return false;
  }
}
const toolWindowWorkspaces = new Map<number, string>();
const activeRemoteJobs = new Set<string>();
const activeRemoteExecutions = new Map<
  string,
  { workspaceId: string; runId: string; provider: "codex" | "claude" | "grok" }
>();
let browserClosure: ReturnType<typeof verifyBrowserClosure> | undefined,
  browserClosureError = "Browser closure has not been verified.";
let inAppBrowser: InAppBrowserController;
const activeReflectionRuns = new Map<string, string>();
const activeReflectionProviders = new Map<
  string,
  "codex" | "claude" | "grok"
>();
const killedReflectionWorkspaces = new Set<string>();
const cancelledReflectionReservations = new Set<string>();

async function processRemoteJobs(workspaceId: string) {
  const sync = syncService.status(workspaceId);
  if (!sync.configured || !sync.deviceId || activeRemoteJobs.has(workspaceId))
    return;
  activeRemoteJobs.add(workspaceId);
  try {
    store.recoverRemoteJobs(workspaceId);
    const profile = store
        .listSecurityProfiles(workspaceId)
        .find(
          (item) =>
            item.name === "Developer · approve changes" && item.peerEligible,
        ),
      policy = store.deviceControlPolicy(workspaceId);
    if (!profile || !policy.enabled) return;
    let claimed: ReturnType<WorkspaceStore["claimRemoteJob"]>;
    for (const capability of policy.allowedCapabilities) {
      claimed = store.claimRemoteJob(
        workspaceId,
        sync.deviceId,
        sync.keyEpoch,
        remotePolicyDigest(capability),
      );
      if (claimed) break;
    }
    if (!claimed) return;
    store.startRemoteJob(workspaceId, claimed.job.id, claimed.leaseId);
    try {
      if (claimed.job.capability === "waypoint.workspace_summary") {
        const execution = await toolGateway.execute(
            {
              version: 1,
              workspaceId,
              origin: "ui",
              tool: "waypoint.command",
              arguments: { command: "workspace.summary", input: {} },
            },
            gatewayPolicy(workspaceId),
          ),
          receipt = execution.result?.receipt;
        if (!receipt || receipt.status !== "completed")
          throw new Error(receipt?.code ?? "remote_domain_command_failed");
        store.finishRemoteJob(
          workspaceId,
          claimed.job.id,
          claimed.leaseId,
          "completed",
          "Workspace summary completed on the selected device",
        );
      } else {
        const cli =
            claimed.job.capability === "agent.codex"
              ? "codex"
              : claimed.job.capability === "agent.grok"
                ? "grok"
                : "claude",
          capability = await detectCli(cli),
          runId = `remote-${claimed.job.id}`,
          events: string[] = [];
        if (
          !capability.available ||
          capability.compatible === false ||
          !capability.executable
        )
          throw new Error(
            capability.compatibilityError ?? `${cli}_cli_unavailable`,
          );
        const onRemoteEvent = (event: ExecutionEvent) => {
            if (event.type === "text" && event.text) events.push(event.text);
          },
          remoteRequest = {
            prompt: claimed.job.instruction,
            workspaceRoot: profile.roots[0],
            profile: { ...profile, maxConcurrency: 1, secretNames: [] },
            executable: capability.executable,
            version: capability.version,
          },
          running =
            cli === "grok"
              ? await grokWorkbench.start(
                  runId,
                  {
                    ...remoteRequest,
                    cli: "grok",
                    onSession: () => undefined,
                    onApproval: async () => ({
                      status: "declined",
                      decision: {},
                    }),
                  },
                  onRemoteEvent,
                )
              : await workbench.start(
                  runId,
                  { ...remoteRequest, cli },
                  onRemoteEvent,
                );
        activeRemoteExecutions.set(claimed.job.id, {
          workspaceId,
          runId,
          provider: cli,
        });
        const terminal = await running.completion;
        activeRemoteExecutions.delete(claimed.job.id);
        if (terminal.status !== "completed")
          throw new Error(`remote_${cli}_${terminal.status}`);
        const summary = events.join("").trim();
        store.finishRemoteJob(
          workspaceId,
          claimed.job.id,
          claimed.leaseId,
          "completed",
          summary || `${cli} completed without a text result`,
        );
      }
    } catch (error) {
      activeRemoteExecutions.delete(claimed.job.id);
      try {
        store.finishRemoteJob(
          workspaceId,
          claimed.job.id,
          claimed.leaseId,
          "failed",
          "Target device could not complete the bounded command",
          error instanceof Error ? error.message : "remote_command_failed",
        );
      } catch {
        /* cancellation or lease expiry won */
      }
    }
  } finally {
    activeRemoteJobs.delete(workspaceId);
  }
}

const activeAutomationWorkspaces = new Set<string>(),
  activeAutomationProvisioningWorkspaces = new Set<string>();
async function withWorkspaceReservation<T>(
  active: Set<string>,
  workspaceId: string,
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (active.has(workspaceId))
    throw new Error(
      `Another ${label} operation is already active for this workspace`,
    );
  active.add(workspaceId);
  try {
    return await operation();
  } finally {
    active.delete(workspaceId);
  }
}

const activeNativeAutomationExecutions = new Map<
  string,
  "codex" | "claude" | "grok"
>();
async function processAutomationRunsV2(workspaceId: string) {
  store.evaluateAutomationEvents(workspaceId);
  if (activeAutomationWorkspaces.has(workspaceId)) return;
  const claimed = store.claimAutomationRun(workspaceId);
  if (!claimed) return;
  activeAutomationWorkspaces.add(workspaceId);
  captureWindow()?.webContents.send("waypoint:automation-run-updated", {
    workspaceId,
    runId: claimed.id,
  });
  let executionId: string | undefined;
  try {
    const cli = claimed.action.provider,
      profile = store
        .listSecurityProfiles(workspaceId)
        .find((item) => item.id === claimed.action.securityProfileId);
    if (!profile)
      throw new Error("Approved automation security profile is unavailable");
    const executionRoot = store.assertWorkspaceExecutionRoot(workspaceId);
    if (
      !claimed.action.executionRoot ||
      path.resolve(claimed.action.executionRoot) !==
        path.resolve(executionRoot) ||
      claimed.action.profileDigest !== securityProfileDigest(profile)
    )
      throw new Error("Approved automation repository authority changed");
    if (claimed.action.kind === "ai_skill" && !profile.tools.includes("skills"))
      throw new Error("Approved automation profile does not allow skills");
    const capability = await detectCli(cli);
    if (
      !capability.available ||
      capability.compatible === false ||
      !capability.executable
    )
      throw new Error(
        capability.compatibilityError ?? `${cli} CLI is unavailable`,
      );
    const chatId = store.createChat(
        workspaceId,
        `Automation · ${claimed.title}`,
      ),
      sourceMessageId = store.addMessage(
        workspaceId,
        chatId,
        "user",
        `Webhook automation started\n\n${claimed.prompt}`,
      ),
      budget = createExecutionBudget({
        kind: "root",
        profile,
        prompt: claimed.prompt,
        attachmentCount: 0,
      });
    executionId = store.createExecution({
      workspaceId,
      chatId,
      sourceMessageId,
      cli,
      model: claimed.action.model,
      securityProfileId: profile.id,
      prompt: claimed.prompt,
      budgetReceipt: serializeExecutionBudget(budget),
    });
    const events: ExecutionEvent[] = [],
      onEvent = (event: ExecutionEvent) => {
        events.push(event);
        store.appendExecutionEvent(executionId!, workspaceId, event);
      },
      shared = {
        prompt: claimed.prompt,
        workspaceRoot: profile.roots[0],
        profile,
        model: claimed.action.model,
        requiredSkillIdentifier:
          claimed.action.kind === "ai_skill"
            ? claimed.action.skillIdentifier
            : undefined,
        executable: capability.executable,
        version: capability.version,
        onSession: (providerSessionId: string) =>
          store.bindProviderSession({
            workspaceId,
            chatId,
            provider: cli,
            providerSessionId,
            executionRoot: profile.roots[0],
            securityProfileId: profile.id,
            model: claimed.action.model,
          }),
        beforeTurn: () => store.assertWorkspaceExecutionRoot(workspaceId),
        onApproval: (request: CodexApprovalRequest, signal: AbortSignal) =>
          awaitProviderDecision(
            {
              workspaceId,
              chatId,
              executionId: executionId!,
              provider: cli,
              request,
            },
            signal,
          ),
      };
    const running =
      cli === "codex"
        ? await codexWorkbench.start(
            executionId,
            { ...shared, cli: "codex" },
            onEvent,
          )
        : cli === "grok"
          ? await grokWorkbench.start(
              executionId,
              { ...shared, cli: "grok" },
              onEvent,
            )
          : await claudeWorkbench.start(
              executionId,
              { ...shared, cli: "claude" },
              onEvent,
            );
    activeNativeAutomationExecutions.set(executionId, cli);
    store.startExecution(
      executionId,
      workspaceId,
      running.executable,
      running.version,
    );
    store.attachAutomationExecution(
      workspaceId,
      claimed.id,
      chatId,
      executionId,
    );
    captureWindow()?.webContents.send("waypoint:automation-run-updated", {
      workspaceId,
      runId: claimed.id,
    });
    void running.completion
      .then(async (result) => {
        await finalizeExecution(store, {
          runId: executionId!,
          workspaceId,
          chatId,
          cli,
          result,
          fallbackEvents: events,
        });
        store.finishAutomationRun(
          workspaceId,
          claimed.id,
          result.status === "completed"
            ? "completed"
            : result.status === "canceled"
              ? "canceled"
              : "failed",
          result.status === "completed"
            ? "Provider completed the exact approved automation route"
            : (result.error ?? `AI ${result.status}`),
          result.status === "completed" ? undefined : result.status,
        );
      })
      .catch((error) => {
        try {
          store.finishAutomationRun(
            workspaceId,
            claimed.id,
            "failed",
            error instanceof Error ? error.message : "AI automation failed",
            "execution_finalization_failed",
          );
        } catch {
          /* terminal state won */
        }
      })
      .finally(() => {
        providerDecisionGate.clearExecution(executionId!);
        activeNativeAutomationExecutions.delete(executionId!);
        activeAutomationWorkspaces.delete(workspaceId);
        captureWindow()?.webContents.send("waypoint:automation-run-updated", {
          workspaceId,
          runId: claimed.id,
        });
      });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Automation run failed";
    if (executionId) {
      providerDecisionGate.clearExecution(executionId);
      try {
        store.failQueuedExecution(executionId, workspaceId, message);
      } catch {
        /* It may already have transitioned; preserve the startup error. */
      }
    }
    if (!executionId && /concurrency/i.test(message))
      store.deferAutomationRun(workspaceId, claimed.id);
    else
      store.finishAutomationRun(
        workspaceId,
        claimed.id,
        "failed",
        message,
        "automation_start_failed",
      );
    activeAutomationWorkspaces.delete(workspaceId);
    captureWindow()?.webContents.send("waypoint:automation-run-updated", {
      workspaceId,
      runId: claimed.id,
    });
  }
}

function gatewayPolicy(
  workspaceId: string,
  securityProfileId?: string,
): ToolGatewayPolicy {
  const profile = store
    .listSecurityProfiles(workspaceId)
    .find((item) =>
      securityProfileId
        ? item.id === securityProfileId
        : item.name === "Developer · approve changes",
    );
  if (!profile) throw new Error("Developer approval profile is unavailable");
  const settings = store.toolGatewaySettings(workspaceId),
    environmentSecrets = Object.keys(process.env).filter((name) =>
      /(?:TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|AUTH|API_KEY|PRIVATE_KEY|CREDENTIAL)/i.test(
        name,
      ),
    ),
    closure = browserClosure,
    [browserId] = settings.browserProfileName.split("."),
    installed =
      settings.browserProfileMode === "existing"
        ? selectedBrowser(browserId)
        : undefined,
    snapshot = path.join(
      app.getPath("userData"),
      "browser-profile-snapshots",
      workspaceId,
      settings.browserProfileName,
    ),
    existingReady = Boolean(installed?.executablePath && existsSync(snapshot)),
    browserReady = Boolean(
      closure &&
      settings.browserAllowedDomains.length > 0 &&
      (settings.browserProfileMode === "isolated" || existingReady),
    ),
    policy: ToolGatewayPolicy = {
      profileName: profile.name,
      roots: profile.roots,
      denyPatterns: settings.denyPatterns,
      stopped: settings.stopped,
      secretNames: [
        ...new Set([...profile.secretNames, ...environmentSecrets]),
      ],
      maxDurationMs: Math.min(120_000, profile.maxDurationMs),
      maxConcurrency: Math.min(4, profile.maxConcurrency),
      suppressCommit: settings.suppressCommit,
      suppressPush: settings.suppressPush,
      webFetchEnabled: settings.webFetchEnabled,
      webSearchEnabled: settings.webSearchEnabled && webSearchVault.hasKey(),
      ...(browserReady
        ? {
            browserExecutable: closure!.agentBrowserExecutable,
            browserBrowserExecutable:
              settings.browserProfileMode === "existing"
                ? installed!.executablePath!
                : closure!.browserExecutable,
            browserProfileMode: settings.browserProfileMode,
            browserNetworkLockdownScript:
              settings.browserProfileMode === "existing"
                ? path.join(
                    process.resourcesPath,
                    "browser-network-lockdown",
                    "lockdown.js",
                  )
                : undefined,
            browserProfileName:
              settings.browserProfileMode === "existing" ? snapshot : undefined,
            browserAllowedDomains: settings.browserAllowedDomains,
            browserSessionName: `workspace-${workspaceId}`,
            browserHomeDir: path.join(
              app.getPath("userData"),
              "browser-sessions",
              workspaceId,
            ),
          }
        : {}),
    };
  validatePolicy(policy);
  return policy;
}

function loadToolFailureFingerprintKey(): Buffer {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(
      "Protected storage is required for tool failure fingerprints",
    );
  const target = path.join(
      app.getPath("userData"),
      "tool-failure-fingerprint.key",
    ),
    temporary = `${target}.partial`;
  try {
    const key = Buffer.from(
      safeStorage.decryptString(readFileSync(target)),
      "base64",
    );
    if (key.length !== 32) throw new Error("Invalid protected fingerprint key");
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const key = randomBytes(32);
  writeFileSync(temporary, safeStorage.encryptString(key.toString("base64")), {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, target);
  return key;
}

function toolFailureKeyFor(
  workspaceId: string,
  vault: ProtectedSyncVault,
): { key: Buffer; capabilityVersion: string } {
  const secrets = vault.load(workspaceId);
  return secrets
    ? workspaceFailureKey(secrets.workspaceKey, secrets.keyEpoch)
    : {
        key: toolFailureFingerprintKey,
        capabilityVersion: "1.0.0/fingerprint:device-v1",
      };
}

async function indexImportedDocument(
  workspaceId: string,
  documentId: string,
  revisionId: string,
  attachmentId: string,
  chunks: DocumentChunk[] = chunkExtractedText(
    store.listDocuments(workspaceId).find((item) => item.id === documentId)
      ?.body ?? "",
  ),
) {
  const key = `${workspaceId}:${documentId}`;
  if (activeDocumentIndexes.has(key))
    return {
      state: "index_busy" as const,
      chunkCount: chunks.length,
      provider: embeddings.provider,
      model: embeddings.model,
    };
  activeDocumentIndexes.add(key);
  try {
    const status = await embeddings.status();
    if (!status.reachable || !status.modelInstalled)
      return {
        state: "provider_unavailable" as const,
        chunkCount: chunks.length,
        provider: embeddings.provider,
        model: embeddings.model,
      };
    const deadline = AbortSignal.timeout(300_000),
      vectors: number[][] = [];
    let modelDigest: string | undefined;
    for (let offset = 0; offset < chunks.length; offset += 32) {
      const result = await embeddings.embed(
        chunks.slice(offset, offset + 32).map((chunk) => chunk.text),
        deadline,
      );
      if (modelDigest && result.modelDigest !== modelDigest)
        throw new Error("Embedding model changed during indexing");
      modelDigest = result.modelDigest;
      vectors.push(...result.vectors);
    }
    if (!modelDigest)
      throw new Error("Embedding provider returned no model provenance");
    store.replaceDocumentChunkGeneration(
      workspaceId,
      { documentId, revisionId, attachmentId },
      chunks.map((chunk, index) => ({ ...chunk, vector: vectors[index] })),
      {
        provider: embeddings.provider,
        providerVersion: embeddings.providerVersion,
        model: embeddings.model,
        modelDigest,
      },
    );
    return {
      state: "indexed" as const,
      chunkCount: chunks.length,
      provider: embeddings.provider,
      model: embeddings.model,
      modelDigest,
    };
  } finally {
    activeDocumentIndexes.delete(key);
  }
}

function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, input: unknown) => unknown,
): void {
  ipcMain.handle(channel, (event, input) => {
    if (
      event.sender.id !== trustedSenderId ||
      event.senderFrame?.url !== trustedRendererUrl
    )
      throw new Error("Unauthorized renderer");
    return listener(event, input);
  });
}
handle("waypoint:open-external", async (_event, input: unknown) => {
  const value = String((input as Record<string, unknown>)?.url ?? "");
  if (value.length > 2048) throw new Error("External link is invalid");
  const url = new URL(value);
  if (
    url.href.length > 2048 ||
    !["https:", "http:", "mailto:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("External link is not allowed");
  await shell.openExternal(url.href);
  return { opened: true };
});

function text(value: unknown, field: string, max?: number): string {
  if (typeof value !== "string" || (max !== undefined && value.length > max))
    throw new Error(`Invalid ${field}`);
  return value;
}
type PreparedChatAttachments = {
  images: CliImageInput[];
  hostedImages: OpenRouterImageInput[];
  textBlocks: ProviderTextAttachment[];
  fileBlocks: ProviderFileAttachment[];
  receipt: string;
  sources: PreparedAttachmentSource[];
  cleanup: () => void;
};
function assertPreparedChatAttachmentsCurrent(
  workspaceId: string,
  chatId: string,
  sources: PreparedAttachmentSource[],
): void {
  assertPreparedAttachmentSources(
    sources,
    store
      .listChatAttachments(workspaceId, chatId)
      .map((item) => ({ id: item.id, sha256: item.sha256 })),
  );
}
function assertPreparedProviderFilesCurrent(
  files: ProviderFileAttachment[],
  executionRoot: string,
): void {
  const canonicalRoot = realpathSync.native(executionRoot);
  for (const file of files) {
    const stat = lstatSync(file.path),
      canonicalFile = realpathSync.native(file.path),
      relative = path.relative(canonicalRoot, canonicalFile);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (relative !== "" &&
        (relative.startsWith("..") || path.isAbsolute(relative))) ||
      createHash("sha256").update(readFileSync(canonicalFile)).digest("hex") !==
        file.sha256
    )
      throw new Error(
        `${file.name}: run-scoped attachment changed before provider launch; retry.`,
      );
  }
}
async function prepareChatAttachments(
  workspaceId: string,
  chatId: string,
  attachmentIds: string[],
  includeHostedPixels = false,
  localExecutionRoot?: string,
): Promise<PreparedChatAttachments> {
  if (new Set(attachmentIds).size !== attachmentIds.length)
    throw new Error("Invalid chat attachment selection");
  const metadata = new Map(
    store
      .listChatAttachments(workspaceId, chatId)
      .map((attachment) => [attachment.id, attachment]),
  );
  if (attachmentIds.some((id) => !metadata.has(id)))
    throw new Error("Attachment not found in chat");
  const images: CliImageInput[] = [],
    hostedImages: OpenRouterImageInput[] = [],
    textBlocks: PreparedChatAttachments["textBlocks"] = [],
    fileBlocks: PreparedChatAttachments["fileBlocks"] = [],
    summaries: string[] = [];
  let snapshotRoot: string | undefined;
  const cleanup = () => {
    if (snapshotRoot) {
      rmSync(snapshotRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      snapshotRoot = undefined;
    }
  };
  try {
    for (const attachmentId of attachmentIds) {
      const item = metadata.get(attachmentId)!,
        label = providerAttachmentLabel(item.name);
      if (
        !CHAT_IMAGE_MEDIA.has(item.mediaType) &&
        !CHAT_DOCUMENT_MEDIA.has(item.mediaType)
      )
        throw new Error(`${label} has no approved chat delivery path`);
      const prepared = store.prepareAttachmentForProvider(
        workspaceId,
        attachmentId,
        {
          inlineText: false,
          filePaths: true,
          acceptedMediaTypes: [...CHAT_IMAGE_MEDIA, ...CHAT_DOCUMENT_MEDIA],
        },
      );
      if (prepared.kind !== "path")
        throw new Error(
          prepared.kind === "unsupported"
            ? `${label}: ${prepared.reason}`
            : `${label} could not be prepared for provider delivery`,
        );
      if (CHAT_IMAGE_MEDIA.has(item.mediaType)) {
        const bytes = readFileSync(prepared.path);
        imageDimensions(item.mediaType, bytes);
        const image = {
          path: prepared.path,
          name: label,
          mediaType: item.mediaType as CliImageInput["mediaType"],
          sha256: prepared.sha256,
        };
        images.push(image);
        if (includeHostedPixels)
          hostedImages.push({
            name: label,
            mediaType: image.mediaType,
            dataBase64: bytes.toString("base64"),
            sha256: prepared.sha256,
          });
        summaries.push(
          `${label} · image pixels · ${prepared.sha256.slice(0, 12)}`,
        );
        continue;
      }
      if (localExecutionRoot) {
        snapshotRoot ??= path.join(
          path.resolve(localExecutionRoot),
          `.waypoint-cli-attachments-${randomUUID()}`,
        );
        mkdirSync(snapshotRoot, { recursive: false, mode: 0o700 });
        markRunScopedAttachmentDirectory(snapshotRoot);
        const extension = path.extname(label).toLowerCase(),
          snapshotPath = path.join(
            snapshotRoot,
            `${fileBlocks.length}${extension}`,
          );
        copyFileSync(prepared.path, snapshotPath);
        const copiedDigest = createHash("sha256")
          .update(readFileSync(snapshotPath))
          .digest("hex");
        if (copiedDigest !== prepared.sha256)
          throw new Error(
            `${label}: attachment changed during run-scoped snapshot creation; retry.`,
          );
        fileBlocks.push({
          name: label,
          mediaType: item.mediaType,
          sha256: prepared.sha256,
          path: snapshotPath,
        });
        summaries.push(
          `${label} · run-scoped provider file · ${prepared.sha256.slice(0, 12)}`,
        );
        continue;
      }
      const extracted = await extractDocumentOffMain(
        prepared.path,
        item.mediaType,
      );
      if (extracted.status !== "extracted")
        throw new Error(`${label}: ${extracted.message}`);
      assertAttachmentExtractionDigest(
        prepared.sha256,
        extracted.sourceDigest,
        label,
      );
      textBlocks.push({
        id: attachmentId,
        name: label,
        mediaType: item.mediaType,
        sha256: prepared.sha256,
        text: extracted.text,
        extractor: extracted.extractor,
        extractorVersion: extracted.extractorVersion,
        ...(extracted.pages ? { pages: extracted.pages } : {}),
      });
      summaries.push(
        `${label} · local text via ${extracted.extractor} ${extracted.extractorVersion} · ${prepared.sha256.slice(0, 12)}`,
      );
    }
    const sources = attachmentIds.map((id) => ({
      id,
      sha256: metadata.get(id)!.sha256,
    }));
    assertPreparedChatAttachmentsCurrent(workspaceId, chatId, sources);
    return {
      images,
      hostedImages,
      textBlocks,
      fileBlocks,
      receipt: summaries.join("; "),
      sources,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
function directoryBytes(root: string): number {
  try {
    const stat = lstatSync(root);
    if (stat.isSymbolicLink()) return 0;
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    return readdirSync(root).reduce(
      (sum, item) => sum + directoryBytes(path.join(root, item)),
      0,
    );
  } catch {
    return 0;
  }
}
async function crossPlatformVoiceCapability() {
  const [sttReady, ttsReady] = await Promise.all([
    fastVoiceTranscription.probe(),
    fastVoiceSpeech.probe(),
  ]);
  return {
    stt: {
      available: sttReady,
      provider: "sherpa-whisper" as const,
      reason: sttReady
        ? "Bundled cross-platform Whisper tiny.en transcription is ready offline."
        : "Bundled local transcription failed its runtime probe. Reinstall Waypoint.",
      source: "bundled" as const,
      model: "Whisper tiny.en int8",
    },
    tts: {
      available: ttsReady,
      provider: ttsReady
        ? ("sherpa-kitten" as const)
        : ("unavailable" as const),
      reason: ttsReady
        ? "Bundled cross-platform Kitten speech is ready offline."
        : "Bundled local speech synthesis failed its runtime probe. Reinstall Waypoint.",
    },
    rawAudioPersistence: false as const,
    cloudSpeech: false as const,
  };
}
function recordVoiceStopRequest(key: string) {
  voiceStopRequests.set(key, performance.now());
  setTimeout(() => voiceStopRequests.delete(key), 5_000).unref();
}

async function collectDiagnostics(workspaceId: string) {
  const local = store.localDiagnostics(workspaceId),
    capabilities = await Promise.all([
      detectCli("codex"),
      detectCli("claude"),
      detectCli("grok"),
    ]);
  return runDiagnostics({
    database: async () => ({
      schemaVersion: local.schemaVersion,
      expectedSchemaVersion: local.expectedSchemaVersion,
      integrity: local.integrity,
      foreignKeyViolations: local.foreignKeyViolations,
    }),
    storage: async () => {
      const stats = statfsSync(app.getPath("userData"));
      let writable = true;
      try {
        accessSync(app.getPath("userData"), constants.W_OK);
      } catch {
        writable = false;
      }
      return {
        freeBytes: Number(stats.bavail) * Number(stats.bsize),
        minimumFreeBytes: 512 * 1024 * 1024,
        writable,
      };
    },
    attachments: async () => ({
      missingFiles: local.missingFiles,
      orphanFiles: local.orphanFiles,
      digestMismatches: local.digestMismatches,
    }),
    search: async () => ({
      indexedObjects: local.indexedObjects,
      expectedObjects: local.expectedObjects,
    }),
    embeddings: () => embeddings.status(),
    cli: async (provider) => {
      const state = capabilities.find(
        (candidate) => candidate.name === provider,
      );
      return {
        configured: Boolean(state?.executable),
        available: Boolean(state?.available),
        version: state?.version,
      };
    },
    sync: async () => {
      const sync = store.syncStatus(workspaceId);
      return {
        configured: syncService.status(workspaceId).configured,
        pending: Number(sync.pendingMutations ?? 0),
        conflicts: Number(sync.conflicts ?? 0),
        activePeers: 0,
      };
    },
  });
}

function openRouterSettingsInput(input: unknown): OpenRouterSettings {
  const value = input as Record<string, unknown>;
  return {
    enabled: value.enabled === true,
    liveRequestsEnabled: value.liveRequestsEnabled === true,
    strategicModel: text(value.strategicModel, "strategic model ID", 200),
    everydayModel: text(value.everydayModel, "everyday model ID", 200),
    attachmentModel: text(value.attachmentModel, "image model ID", 200),
    fallbackProvider: ["codex", "claude", "grok"].includes(
      String(value.fallbackProvider),
    )
      ? (value.fallbackProvider as "codex" | "claude" | "grok")
      : undefined,
    monthlyCapMicros: Number(value.monthlyCapMicros),
    ytdCapMicros: Number(value.ytdCapMicros),
    perRequestCapMicros: Number(value.perRequestCapMicros),
    warningPercent: Number(value.warningPercent),
  };
}

function registerIpc(): void {
  handle("waypoint:screen-capture-readiness", () => {
    const permission =
      process.platform === "darwin"
        ? (systemPreferences.getMediaAccessStatus("screen") as
            "granted" | "denied" | "restricted" | "not-determined" | "unknown")
        : "unknown";
    return {
      ...captureReadiness(process.platform, permission),
      shortcut: captureShortcutState,
    };
  });
  handle("waypoint:screen-capture-settings", (_event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>)?.workspaceId,
      "workspace id",
      128,
    );
    const settings = store.screenCaptureSettings(workspaceId);
    registerCaptureShortcut(workspaceId, settings);
    return settings;
  });
  handle(
    "waypoint:screen-capture-settings-update",
    (_event, input: unknown) => {
      const value = input as Record<string, unknown>,
        workspaceId = text(value.workspaceId, "workspace id", 128),
        settings = validateCaptureSettings(
          value.settings as Parameters<typeof validateCaptureSettings>[0],
        );
      const saved = store.setScreenCaptureSettings(workspaceId, settings),
        shortcutReady = registerCaptureShortcut(workspaceId, saved);
      return {
        ...saved,
        shortcutReady,
        shortcutReason: shortcutReady
          ? "Global shortcut ready"
          : "Shortcut is already used by another application",
      };
    },
  );
  handle(
    "waypoint:screen-capture-shortcut-recording",
    (_event, input: unknown) => {
      const value = input as Record<string, unknown>,
        workspaceId = text(value.workspaceId, "workspace id", 128),
        active = Boolean(value.active),
        settings = store.screenCaptureSettings(workspaceId);
      captureShortcutSuspended = active;
      if (active) {
        if (captureShortcutState.shortcut)
          globalShortcut.unregister(captureShortcutState.shortcut);
        captureShortcutState = {
          registered: false,
          shortcut: settings.shortcut,
          reason: "Shortcut paused while recording a replacement",
        };
        return captureShortcutState;
      }
      registerCaptureShortcut(workspaceId, settings);
      return captureShortcutState;
    },
  );
  handle("waypoint:screen-capture-sources", async (event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace id", 128),
      mode = text(value.mode, "capture mode", 16) as CaptureMode;
    store.screenCaptureSettings(workspaceId);
    if (!["region", "window", "display"].includes(mode))
      throw new Error("Invalid capture mode");
    for (const [token, item] of pendingManualCaptures)
      if (item.expiresAt < Date.now()) pendingManualCaptures.delete(token);
    const sources = await desktopCapturer.getSources({
      types: mode === "window" ? ["window"] : ["screen"],
      thumbnailSize: { width: 3840, height: 2160 },
      fetchWindowIcons: true,
    });
    return sources.map((source) => {
      const size = source.thumbnail.getSize(),
        token = randomUUID();
      pendingManualCaptures.set(token, {
        workspaceId,
        senderId: event.sender.id,
        sourceId: source.id,
        sourceName: source.name,
        mode,
        width: size.width,
        height: size.height,
        expiresAt: Date.now() + 120_000,
      });
      return {
        token,
        name: source.name,
        displayId: source.display_id,
        thumbnailDataUrl: source.thumbnail
          .resize({ width: Math.min(560, size.width) })
          .toDataURL(),
        width: size.width,
        height: size.height,
      };
    });
  });
  handle("waypoint:screen-capture-create", async (event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace id", 128),
      token = text(value.token, "capture token", 128),
      pending = pendingManualCaptures.get(token);
    if (
      !pending ||
      pending.expiresAt < Date.now() ||
      pending.workspaceId !== workspaceId ||
      pending.senderId !== event.sender.id
    )
      throw new Error(
        "Capture selection expired or belongs to another workspace. Choose the source again.",
      );
    pendingManualCaptures.delete(token);
    const window = BrowserWindow.fromWebContents(event.sender),
      visibility = captureVisibilityStrategy(pending.mode);
    try {
      if (visibility.hideWindow) {
        window?.hide();
        await new Promise((resolve) => setTimeout(resolve, 180));
      } else if (visibility.hideOverlay)
        await setCaptureOverlayVisibility(event.sender, true);
      const sources = await desktopCapturer.getSources({
          types: pending.mode === "window" ? ["window"] : ["screen"],
          thumbnailSize: { width: pending.width, height: pending.height },
          fetchWindowIcons: false,
        }),
        source = sources.find((item) => item.id === pending.sourceId);
      if (!source || source.thumbnail.isEmpty())
        throw new Error(
          "The selected source is no longer available. Choose it again.",
        );
      const size = source.thumbnail.getSize();
      try {
        assertVisibleCapturePixels(
          source.thumbnail.toBitmap(),
          size.width,
          size.height,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "screen_capture_no_visible_pixels"
        )
          throw new Error(
            "Capture returned no visible pixels. Check Screen Recording permission, make sure the selected window is visible, then try again.",
            { cause: error },
          );
        throw error;
      }
      const png = source.thumbnail.toPNG();
      return store.createScreenCapture(
        workspaceId,
        {
          title: `Screenshot · ${pending.sourceName}`,
          mode: pending.mode,
          sourceId: pending.sourceId,
          sourceName: pending.sourceName,
          capturedAt: new Date().toISOString(),
          width: size.width,
          height: size.height,
        },
        png,
      );
    } finally {
      if (visibility.hideWindow) {
        window?.show();
        window?.focus();
      } else if (visibility.hideOverlay)
        await setCaptureOverlayVisibility(event.sender, false).catch(
          () => undefined,
        );
    }
  });
  handle("waypoint:screen-capture-cancel-sources", (event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>)?.workspaceId,
      "workspace id",
      128,
    );
    for (const [token, pending] of pendingManualCaptures)
      if (
        pending.workspaceId === workspaceId &&
        pending.senderId === event.sender.id
      )
        pendingManualCaptures.delete(token);
    return { canceled: true };
  });
  handle(
    "waypoint:screen-capture-import-browser",
    async (_event, input: unknown) => {
      const workspaceId = text(
          (input as Record<string, unknown>)?.workspaceId,
          "workspace id",
          128,
        ),
        capture = await inAppBrowser.capturePng(workspaceId);
      return store.createScreenCapture(
        workspaceId,
        {
          title: `Browser · ${capture.title}`.slice(0, 120),
          mode: "browser",
          sourceId: createHash("sha256").update(capture.url).digest("hex"),
          sourceName: new URL(capture.url).hostname,
          capturedAt: new Date().toISOString(),
          width: capture.width,
          height: capture.height,
        },
        capture.png,
      );
    },
  );
  handle("waypoint:screen-capture-list", (_event, input: unknown) =>
    store.listScreenCaptures(
      text(
        (input as Record<string, unknown>)?.workspaceId,
        "workspace id",
        128,
      ),
    ),
  );
  handle("waypoint:screen-capture-read", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.readScreenCapture(
      text(value.workspaceId, "workspace id", 128),
      text(value.captureId, "capture id", 128),
    );
  });
  handle("waypoint:screen-capture-update", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.updateScreenCapture(
      text(value.workspaceId, "workspace id", 128),
      text(value.captureId, "capture id", 128),
      value.layers,
      value.flattenedBytes instanceof Uint8Array
        ? value.flattenedBytes
        : undefined,
    );
  });
  handle("waypoint:screen-capture-copy", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      capture = store.readScreenCapture(
        text(value.workspaceId, "workspace id", 128),
        text(value.captureId, "capture id", 128),
      );
    clipboard.writeImage(
      nativeImage.createFromBuffer(Buffer.from(capture.dataBase64, "base64")),
    );
    return { copied: true };
  });
  handle("waypoint:screen-capture-save", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      capture = store.readScreenCapture(
        text(value.workspaceId, "workspace id", 128),
        text(value.captureId, "capture id", 128),
      ),
      result = await dialog.showSaveDialog({
        title: "Save screenshot",
        defaultPath: "Waypoint screenshot.png",
        filters: [{ name: "PNG image", extensions: ["png"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
    if (result.canceled || !result.filePath) return { canceled: true };
    writeFileSync(result.filePath, Buffer.from(capture.dataBase64, "base64"), {
      mode: 0o600,
    });
    return { canceled: false };
  });
  handle("waypoint:screen-capture-add-chat", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.addScreenCaptureToChat(
      text(value.workspaceId, "workspace id", 128),
      text(value.captureId, "capture id", 128),
      text(value.chatId, "chat id", 128),
    );
  });
  handle("waypoint:screen-capture-add-knowledge", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.addScreenCaptureToKnowledge(
      text(value.workspaceId, "workspace id", 128),
      text(value.captureId, "capture id", 128),
    );
  });
  handle("waypoint:screen-capture-delete", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteScreenCapture(
      text(value.workspaceId, "workspace id", 128),
      text(value.captureId, "capture id", 128),
    );
    return { deleted: true };
  });
  const assertBrowserWorkspace = (
    event: IpcMainInvokeEvent,
    workspaceId: string,
  ) => {
    if (toolWindowWorkspaces.get(event.sender.id) !== workspaceId)
      throw new Error("browser_workspace_scope_denied");
  };
  handle("waypoint:bootstrap", () => ({ workspaces: store.listWorkspaces() }));
  handle("waypoint:activity-capture-status", (_event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    return {
      policy: store.activityCapturePolicy(workspaceId),
      readiness: macActivityCaptureReadiness(),
      storage: store.activityCaptureStorage(workspaceId),
    };
  });
  handle("waypoint:activity-capture-update", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      policy = validateActivityCapturePolicy(value.policy);
    return {
      policy: store.setActivityCapturePolicy(workspaceId, policy),
      readiness: macActivityCaptureReadiness(),
      storage: store.activityCaptureStorage(workspaceId),
    };
  });
  handle("waypoint:activity-capture-list", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.listActivitySnapshots(
      text(value.workspaceId, "workspace ID", 64),
      value.query == null
        ? ""
        : text(value.query, "activity capture query", 100),
    );
  });
  handle("waypoint:activity-capture-read", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.readActivitySnapshot(
      text(value.workspaceId, "workspace ID", 64),
      text(value.snapshotId, "snapshot ID", 64),
    );
  });
  handle("waypoint:activity-capture-delete", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteActivitySnapshot(
      text(value.workspaceId, "workspace ID", 64),
      text(value.snapshotId, "snapshot ID", 64),
    );
    return { deleted: true };
  });
  handle("waypoint:activity-capture-delete-all", (_event, input: unknown) => ({
    deleted: store.deleteAllActivitySnapshots(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  }));
  handle("waypoint:activity-capture-purge", (_event, input: unknown) => ({
    purged: store.purgeExpiredActivitySnapshots(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  }));
  handle("waypoint:reflection-runs", (_event, input: unknown) =>
    store.listReflectionRuns(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:reflection-proposals", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.listReflectionProposals(
      text(value.workspaceId, "workspace ID", 64),
      text(value.runId, "run ID", 64),
    );
  });
  handle("waypoint:reflection-start", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      sourceIds = value.sourceIds,
      provider = ["codex", "claude", "grok"].includes(String(value.provider))
        ? (String(value.provider) as "codex" | "claude" | "grok")
        : "codex",
      reservation = `pending-${randomUUID()}`;
    if (store.toolGatewaySettings(workspaceId).stopped)
      throw new Error("Workspace stop is active");
    if (activeReflectionRuns.has(workspaceId))
      throw new Error("A reflection is already running in this workspace");
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.some((id) => typeof id !== "string")
    )
      throw new Error("Reflection sources are invalid");
    activeReflectionRuns.set(workspaceId, reservation);
    let runId: string | undefined;
    try {
      const capability = await detectCli(provider);
      if (cancelledReflectionReservations.has(reservation))
        throw new Error(
          "reflection_canceled:Canceled during capability detection",
        );
      if (activeReflectionRuns.get(workspaceId) !== reservation)
        throw new Error(
          "reflection_killed:Workspace stop became active during capability detection",
        );
      if (store.toolGatewaySettings(workspaceId).stopped)
        throw new Error(
          "reflection_killed:Workspace stop became active during capability detection",
        );
      if (!capability.available || !capability.executable)
        throw new Error(
          `${provider} CLI is not signed in or available for local reflection`,
        );
      if (capability.compatible === false)
        throw new Error(capability.compatibilityError);
      const sources = store.reflectionSourceEnvelope(
          workspaceId,
          sourceIds as string[],
        ),
        serialized = JSON.stringify(sources);
      const preliminary = store.createReflectionRun(
        workspaceId,
        sourceIds as string[],
        provider,
      );
      runId = preliminary.runId;
      const profile = store
        .listSecurityProfiles(workspaceId)
        .find(
          (item) =>
            item.filesystem === "read-only" &&
            item.network === "provider-only" &&
            item.tools.every((tool) => tool === "provider-native"),
        );
      if (!profile)
        throw new Error(
          "A read-only, provider-only, no-tools security profile is required for reflection",
        );
      if (
        activeReflectionRuns.get(workspaceId) !== reservation ||
        store.toolGatewaySettings(workspaceId).stopped
      )
        throw new Error(
          "reflection_killed:Workspace stop became active before launch",
        );
      activeReflectionRuns.set(workspaceId, runId);
      store.markReflectionRunReviewing(workspaceId, runId);
      const prompt = `You are Waypoint's bounded memory reflection reviewer. Analyze only the exact local sources below. Do not use tools, files, network, or outside facts. Return exactly one marker block and nothing else: <waypoint-reflection>[{"kind":"duplicate|stale|contradiction","title":"...","beforeBody":"...","proposedBody":"...","rationale":"...","sourceIds":["exact source IDs"]}]</waypoint-reflection>. Never choose a winner for a contradiction; leave proposedBody empty. Sources: ${serialized}`,
        events: ExecutionEvent[] = [];
      const reflectionRunId = `reflection-${runId}`,
        onReflectionEvent = (event: ExecutionEvent) => {
          if (event.type === "text" && event.text) events.push(event);
        },
        execution =
          provider === "grok"
            ? await grokWorkbench.start(
                reflectionRunId,
                {
                  cli: "grok",
                  prompt,
                  workspaceRoot: profile.roots[0],
                  profile: {
                    ...profile,
                    tools: [],
                    maxConcurrency: 1,
                    secretNames: [],
                  },
                  isolatedNoTools: true,
                  executable: capability.executable,
                  version: capability.version,
                  onSession: () => undefined,
                  onApproval: async () => ({
                    status: "declined",
                    decision: {},
                  }),
                },
                onReflectionEvent,
              )
            : await workbench.start(
                reflectionRunId,
                {
                  cli: provider,
                  prompt,
                  workspaceRoot: profile.roots[0],
                  profile: { ...profile, maxConcurrency: 1, secretNames: [] },
                  executable: capability.executable,
                  version: capability.version,
                },
                onReflectionEvent,
              );
      activeReflectionProviders.set(runId, provider);
      const terminal = await execution.completion;
      if (terminal.status !== "completed")
        throw new Error(
          `reflection_${terminal.status}:${terminal.error ?? terminal.status}`,
        );
      if (
        activeReflectionRuns.get(workspaceId) !== runId ||
        cancelledReflectionReservations.has(runId)
      )
        throw new Error(
          "reflection_canceled:Reflection was canceled before proposals were applied",
        );
      if (
        store.toolGatewaySettings(workspaceId).stopped ||
        killedReflectionWorkspaces.has(workspaceId)
      )
        throw new Error(
          "reflection_killed:Workspace stop became active before proposals were applied",
        );
      const output = events.map((event) => event.text ?? "").join(""),
        matches = [
          ...output.matchAll(
            /<waypoint-reflection>([\s\S]*?)<\/waypoint-reflection>/g,
          ),
        ];
      if (matches.length !== 1 || output.trim() !== matches[0][0])
        throw new Error(
          "Reflection CLI must return exactly one bounded proposal block",
        );
      if (
        activeReflectionRuns.get(workspaceId) !== runId ||
        store.toolGatewaySettings(workspaceId).stopped ||
        killedReflectionWorkspaces.has(workspaceId) ||
        cancelledReflectionReservations.has(runId)
      )
        throw new Error(
          store.toolGatewaySettings(workspaceId).stopped ||
            killedReflectionWorkspaces.has(workspaceId)
            ? "reflection_killed:Workspace stop became active before apply"
            : "reflection_canceled:Reflection was canceled before apply",
        );
      return store.applyReflectionCliAnalysis(
        workspaceId,
        runId,
        provider,
        capability.version ?? "unknown",
        JSON.parse(matches[0][1]),
      );
    } catch (error) {
      const message =
          error instanceof Error ? error.message : "Local reflection failed",
        status =
          killedReflectionWorkspaces.has(workspaceId) ||
          message.startsWith("reflection_killed")
            ? "killed"
            : message.startsWith("reflection_canceled")
              ? "cancelled"
              : "failed";
      if (runId) store.failReflectionRun(workspaceId, runId, status, message);
      throw error;
    } finally {
      if (
        activeReflectionRuns.get(workspaceId) === reservation ||
        activeReflectionRuns.get(workspaceId) === runId
      )
        activeReflectionRuns.delete(workspaceId);
      killedReflectionWorkspaces.delete(workspaceId);
      cancelledReflectionReservations.delete(reservation);
      if (runId) {
        cancelledReflectionReservations.delete(runId);
        activeReflectionProviders.delete(runId);
      }
    }
  });
  handle("waypoint:reflection-cancel", (_event, input: unknown) => {
    const workspaceId = text(
        (input as Record<string, unknown>).workspaceId,
        "workspace ID",
        64,
      ),
      runId = activeReflectionRuns.get(workspaceId);
    if (!runId) return { canceled: false };
    cancelledReflectionReservations.add(runId);
    if (!runId.startsWith("pending-")) {
      if (activeReflectionProviders.get(runId) === "grok")
        grokWorkbench.cancel(`reflection-${runId}`);
      else workbench.cancel(`reflection-${runId}`);
    }
    return { canceled: true };
  });
  handle("waypoint:reflection-resolve", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      action = String(value.action);
    if (!["accept", "edit", "reject", "rollback"].includes(action))
      throw new Error("Reflection action is invalid");
    return store.resolveReflectionProposal(
      text(value.workspaceId, "workspace ID", 64),
      text(value.proposalId, "proposal ID", 64),
      action as "accept" | "edit" | "reject" | "rollback",
      value.editedBody == null
        ? undefined
        : text(value.editedBody, "edited reflection", 200000),
    );
  });
  handle("waypoint:voice-capability", () => crossPlatformVoiceCapability());
  handle("waypoint:voice-engine-status", async (_event, input: unknown) => {
    const workspaceId = text(
        (input as Record<string, unknown>).workspaceId,
        "workspace ID",
        64,
      ),
      preference = store.voicePreferences(workspaceId),
      experimental = voicePacks.status("full_duplex_experimental"),
      [ttsReady, sttReady] = await Promise.all([
        fastVoiceSpeech.probe(),
        fastVoiceTranscription.probe(),
      ]),
      ready = sttReady && ttsReady;
    return {
      selected: preference.engine,
      engines: [
        {
          id: "fast_local" as const,
          label: "Fast Local",
          ready,
          version:
            "sherpa-onnx-1.13.4/whisper-tiny.en-int8/kitten-nano-en-v0.1-fp16",
          packageBytes: fastVoicePackageBytes,
          minimumRamBytes: 1024 ** 3,
          conversationOwner: "waypoint-providers" as const,
          install: "bundled" as const,
          reason: ready
            ? "Bundled cross-platform Whisper transcription and Apache-licensed Kitten speech are verified and ready offline."
            : `${sttReady ? "" : "Bundled transcription failed its runtime probe. "}${ttsReady ? "" : "Bundled speech synthesis failed its runtime probe."} Reinstall Waypoint.`,
          metrics: fastVoiceMetric
            ? {
                firstAudioMs: fastVoiceMetric.firstAudioMs,
                interruptionMs: fastInterruptionMs,
                turnEndMs: fastVoiceMetric.generationMs,
                measuredAt: new Date().toISOString(),
                fixture: false,
              }
            : fixtureVoiceMetrics(
                [
                  { atMs: 300, durationMs: 80 },
                  { atMs: 380, durationMs: 80 },
                ],
                400,
                445,
              ),
        },
        {
          ...experimental,
          metrics: experimental.metrics.fixture
            ? experimental.metrics
            : fixtureVoiceMetrics(
                [
                  { atMs: 650, durationMs: 80 },
                  { atMs: 730, durationMs: 80 },
                ],
                800,
                860,
              ),
        },
      ],
    };
  });
  handle("waypoint:voice-configure", async () => ({
    canceled: false,
    capability: await crossPlatformVoiceCapability(),
  }));
  handle("waypoint:voice-preferences", (_event, input: unknown) =>
    store.voicePreferences(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:voice-update-preferences", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      engine = String(
        value.engine ?? store.voicePreferences(workspaceId).engine,
      ) as VoiceEngineId;
    if (
      engine === "full_duplex_experimental" &&
      !voicePacks.status(engine).ready
    )
      throw new Error("voice_engine_not_ready");
    return store.setVoicePreferences(workspaceId, {
      mode: String(value.mode),
      microphoneId: String(value.microphoneId ?? ""),
      outputVoice: String(value.outputVoice),
      engine,
    });
  });
  handle("waypoint:voice-remove-runtime", async () => {
    voiceRuntime.remove();
    return { capability: await crossPlatformVoiceCapability() };
  });
  handle("waypoint:voice-transcribe", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64),
      mode = value.mode === "hands_free" ? "hands_free" : "push_to_talk";
    if (store.toolGatewaySettings(workspaceId).stopped)
      throw new Error("voice_global_stop_active");
    const audio = value.audio;
    if (!(audio instanceof Uint8Array)) throw new Error("voice_audio_invalid");
    const controller = voiceOperations.begin(workspaceId, chatId);
    store.recordVoiceActivity(workspaceId, chatId, "started", { mode });
    try {
      const result = await fastVoiceTranscription.transcribe(
        audio,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        store.toolGatewaySettings(workspaceId).stopped
      )
        throw new Error("voice_canceled");
      store.recordVoiceActivity(workspaceId, chatId, "transcribed", {
        mode,
        provider: result.provider,
      });
      return { text: result.text, provider: result.provider };
    } catch (error) {
      const code = controller.signal.aborted
        ? "voice_canceled"
        : voiceFailureCode(error);
      store.recordVoiceActivity(workspaceId, chatId, "failed", {
        mode,
        reason: code,
      });
      throw new Error(code, { cause: error });
    } finally {
      voiceOperations.finish(workspaceId, chatId, controller);
      audio.fill(0);
    }
  });
  handle("waypoint:voice-speak", (event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64),
      turnId = Number(value.turnId),
      body = text(value.text, "speech text", 200_000);
    if (!Number.isSafeInteger(turnId) || turnId < 1)
      throw new Error("voice_turn_invalid");
    if (store.toolGatewaySettings(workspaceId).stopped)
      throw new Error("voice_global_stop_active");
    if (store.voicePreferences(workspaceId).engine !== "fast_local")
      throw new Error("voice_engine_not_ready");
    const previous = voiceSpeechOwner;
    if (previous) {
      fastVoiceSpeech.stop();
      voiceSpeechOwner = undefined;
      if (!event.sender.isDestroyed())
        event.sender.send("waypoint:voice-audio-stop", {
          workspaceId: previous.workspaceId,
          chatId: previous.chatId,
          turnId: previous.turnId,
        });
      previous.notify("canceled");
    }
    const owner = {
      workspaceId,
      chatId,
      turnId,
      notify: (result: SpeechResult) => {
        store.recordVoiceActivity(
          workspaceId,
          chatId,
          result === "failed" ? "failed" : "stopped",
          { reason: `tts_${result}` },
        );
        if (!event.sender.isDestroyed())
          event.sender.send("waypoint:voice-speech-state", {
            workspaceId,
            chatId,
            turnId,
            result,
          });
      },
    };
    voiceSpeechOwner = owner;
    void fastVoiceSpeech
      .speak(body, (samples, sampleRate, index) => {
        if (voiceSpeechOwner !== owner || event.sender.isDestroyed()) return;
        event.sender.send("waypoint:voice-audio-chunk", {
          workspaceId,
          chatId,
          turnId,
          index,
          sampleRate,
          samples,
        });
      })
      .then((metric) => {
        if (voiceSpeechOwner !== owner) return;
        fastVoiceMetric = metric;
        if (metric.canceled) return;
        if (!event.sender.isDestroyed())
          event.sender.send("waypoint:voice-audio-end", {
            workspaceId,
            chatId,
            turnId,
          });
      })
      .catch(() => {
        if (voiceSpeechOwner !== owner) return;
        voiceSpeechOwner = undefined;
        owner.notify("failed");
      });
    return { speaking: true };
  });
  handle("waypoint:voice-playback-complete", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64),
      turnId = Number(value.turnId);
    const owner = voiceSpeechOwner;
    if (
      owner &&
      owner.workspaceId === workspaceId &&
      owner.chatId === chatId &&
      owner.turnId === turnId
    ) {
      voiceSpeechOwner = undefined;
      owner.notify("completed");
      return { completed: true };
    }
    return { completed: false };
  });
  handle("waypoint:voice-playback-stopped", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64),
      turnId = Number(value.turnId),
      key = `${workspaceId}:${chatId}:${turnId}`,
      started = voiceStopRequests.get(key);
    if (started === undefined) return { recorded: false };
    voiceStopRequests.delete(key);
    fastInterruptionMs = Math.max(0, performance.now() - started);
    return { recorded: true };
  });
  handle("waypoint:voice-stop", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64);
    voiceOperations.stop(workspaceId, chatId);
    if (
      voiceSpeechOwner?.workspaceId === workspaceId &&
      voiceSpeechOwner.chatId === chatId
    ) {
      const owner = voiceSpeechOwner;
      fastVoiceSpeech.stop();
      voiceSpeechOwner = undefined;
      recordVoiceStopRequest(`${workspaceId}:${chatId}:${owner.turnId}`);
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send("waypoint:voice-audio-stop", {
          workspaceId,
          chatId,
          turnId: owner.turnId,
        });
    }
    store.recordVoiceActivity(workspaceId, chatId, "stopped", {
      reason: "user_stop",
    });
    return { stopped: true };
  });
  handle("waypoint:tool-gateway-capabilities", () => {
    const settings = store.openRouterSettings(),
      capability = openRouterCapability(
        settings,
        providerKeyConfigured(),
        store.providerUsage().summary,
      );
    return {
      version: 1,
      tools: toolGateway
        .descriptors()
        .filter(
          (item) =>
            item.name !== "agent_browser.run" || Boolean(browserClosure),
        ),
      localClis: [
        discoverLocalCli("git"),
        discoverLocalCli("gh"),
        discoverLocalCli("az"),
      ],
      browser: {
        available: Boolean(browserClosure),
        backend: "Vercel Labs Agent Browser",
        version: AGENT_BROWSER_VERSION,
        profiles: ["isolated"],
        reason: browserClosure
          ? "Verified bundled interactive runtime for isolated sessions. Existing signed-in profile remains repair-required until a non-mutating contained import passes."
          : browserClosureError,
      },
      web: {
        fetchAvailable: true,
        searchKeyConfigured: webSearchVault.hasKey(),
        searchProvider: "Brave Search API",
        reason: webSearchVault.hasKey()
          ? "Search key is protected locally; each workspace must opt in before external requests are allowed."
          : "Add a Brave Search API key in Settings to make web search available. No background request is made.",
      },
      remoteProviders: {
        available: capability.available,
        provider: "openrouter",
        state: capability.state,
        health: capability.health,
        reason: capability.reason,
      },
      crossDevice: {
        available: true,
        reason:
          "User-dispatched workspace summary jobs are available when encrypted sync and target worker policy are enabled.",
      },
    };
  });
  handle("waypoint:cross-workspace-rollup-settings", (_event, input: unknown) =>
    store.crossWorkspaceRollupSettings(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:cross-workspace-rollup-update", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      body = value.value as Record<string, unknown>,
      grants = Array.isArray(body.grants)
        ? body.grants.map((grant) => {
            const item = grant as Record<string, unknown>,
              family = String(item.family);
            if (
              !["commitments", "meetings", "briefing_status"].includes(family)
            )
              throw new Error("Roll-up family is invalid");
            return {
              sourceWorkspaceId: text(
                item.sourceWorkspaceId,
                "source workspace ID",
                64,
              ),
              family: family as "commitments" | "meetings" | "briefing_status",
              enabled: item.enabled === true,
            };
          })
        : [];
    return store.setCrossWorkspaceRollupSettings(workspaceId, {
      standingEnabled: body.standingEnabled === true,
      grants,
    });
  });
  handle(
    "waypoint:cross-workspace-rollup-compose",
    (_event, input: unknown) => {
      const value = input as Record<string, unknown>,
        families = Array.isArray(value.families)
          ? value.families
              .map(String)
              .filter(
                (
                  item,
                ): item is "commitments" | "meetings" | "briefing_status" =>
                  ["commitments", "meetings", "briefing_status"].includes(item),
              )
          : undefined;
      return store.composeCrossWorkspaceRollup(
        text(value.workspaceId, "workspace ID", 64),
        families,
      );
    },
  );
  handle("waypoint:web-search-set-key", (_event, input: unknown) => {
    webSearchVault.setKey(
      text(
        (input as Record<string, unknown>).apiKey,
        "Brave Search API key",
        512,
      ),
    );
    return { keyConfigured: true };
  });
  handle("waypoint:web-search-remove-key", () => {
    webSearchVault.removeKey();
    for (const workspace of store.listWorkspaces()) {
      const current = store.toolGatewaySettings(workspace.id);
      if (current.webSearchEnabled)
        store.setToolGatewaySettings(workspace.id, {
          ...current,
          webSearchEnabled: false,
        });
    }
    return { keyConfigured: false };
  });
  handle("waypoint:openrouter-status", () => {
    const settings = store.openRouterSettings(),
      usage = store.providerUsage(),
      keyConfigured = providerKeyConfigured(),
      base = openRouterCapability(settings, keyConfigured, usage.summary),
      latest = usage.receipts[0],
      capability =
        latest?.status === "completed" && base.available
          ? {
              ...base,
              health: "verified" as const,
              reason:
                "Configured and last authorized request completed; current model availability is rechecked per request.",
            }
          : latest?.status === "failed" && base.available
            ? {
                ...base,
                health: "failed" as const,
                reason:
                  "The last authorized hosted request failed; no background health call is made.",
              }
            : base;
    return { settings, keyConfigured, capability, usage };
  });
  handle("waypoint:openrouter-set-key", (_event, input: unknown) => {
    providerVault.setKey(
      text(
        (input as Record<string, unknown>).apiKey,
        "OpenRouter API key",
        512,
      ),
    );
    return { keyConfigured: true };
  });
  handle("waypoint:openrouter-remove-key", () => {
    providerVault.removeKey();
    const current = store.openRouterSettings();
    store.setOpenRouterSettings({ ...current, liveRequestsEnabled: false });
    return { keyConfigured: false };
  });
  handle("waypoint:openrouter-update-settings", (_event, input: unknown) =>
    store.setOpenRouterSettings(openRouterSettingsInput(input)),
  );
  handle("waypoint:openrouter-update-routing", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      thinking = value.thinking as Record<string, unknown>,
      settings = openRouterSettingsInput(value.settings);
    const preference = (input: unknown): ThinkingEffort | "" => {
      const effort = String(input ?? "");
      if (effort && !isThinkingEffort(effort))
        throw new Error("OpenRouter thinking preference is invalid");
      return effort as ThinkingEffort | "";
    };
    const nextThinking = {
      openrouterStrategic: preference(thinking.openrouterStrategic),
      openrouterEveryday: preference(thinking.openrouterEveryday),
      openrouterAttachment: preference(thinking.openrouterAttachment),
    };
    for (const [lane, model] of [
      ["openrouterStrategic", settings.strategicModel],
      ["openrouterEveryday", settings.everydayModel],
      ["openrouterAttachment", settings.attachmentModel],
    ] as const) {
      const effort = nextThinking[lane];
      if (
        effort &&
        !openRouterModelThinking(model)?.supported.includes(effort)
      )
        throw new Error(
          `The ${lane} thinking level is not supported by its selected model`,
        );
    }
    return store.setOpenRouterRouting(workspaceId, settings, nextThinking);
  });
  handle("waypoint:run-openrouter-chat", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64),
      sourceMessageId = text(value.sourceMessageId, "source message ID", 64),
      prompt = text(value.prompt, "prompt"),
      securityProfileId = text(
        value.securityProfileId,
        "security profile ID",
        64,
      ),
      role =
        value.role === "strategic"
          ? ("strategic" as const)
          : ("everyday" as const);
    assertChatMayStart(workspaceId, chatId);
    const attachmentIds = Array.isArray(value.attachmentIds)
      ? value.attachmentIds.map((item) => text(item, "attachment ID", 64))
      : [];
    const automationProfile = store
      .listSecurityProfiles(workspaceId)
      .find((item) => item.id === securityProfileId);
    if (!automationProfile) throw new Error("Security profile is unavailable");
    const hostedPolicy = gatewayPolicy(workspaceId, securityProfileId),
      hostedTools = openRouterTools(automationProfile),
      hostedToolNames = new Set(hostedTools.map((item) => item.function.name));
    const settings = store.openRouterSettings(),
      usage = store.providerUsage(),
      apiKey = providerVault.getKey(),
      subscriptions = (
        await Promise.all([
          detectCli("codex"),
          detectCli("claude"),
          detectCli("grok"),
        ])
      )
        .filter((item) => item.available && item.compatible !== false)
        .map((item) => item.name as "codex" | "claude" | "grok"),
      fallback = (provider: "codex" | "claude" | "grok", reason: string) => {
        const timestamp = new Date().toISOString(),
          receipt: ProviderUsageReceipt = {
            id: randomUUID(),
            workspaceId,
            provider: "openrouter",
            model:
              role === "strategic"
                ? settings.strategicModel
                : settings.everydayModel,
            role,
            status: "blocked",
            costMicros: 0,
            promptTokens: 0,
            completionTokens: 0,
            requestDigest: createHash("sha256")
              .update(`fallback:${workspaceId}:${sourceMessageId}`)
              .digest("hex"),
            fallbackProvider: provider,
            errorCode: "cap_fallback",
            startedAt: timestamp,
            finishedAt: timestamp,
          };
        store.saveProviderUsage(receipt);
        return { fallbackProvider: provider, reason };
      };
    const route = decideHostedRoute({
      settings,
      keyConfigured: true,
      summary: usage.summary,
      role,
      availableSubscriptions: subscriptions,
    });
    if (route.provider !== "openrouter")
      return fallback(route.provider, route.reason);
    store.assertWorkspaceExecutionRoot(workspaceId);
    const preparedAttachments = await prepareChatAttachments(
        workspaceId,
        chatId,
        attachmentIds,
        true,
      ),
      attachmentRoute = selectOpenRouterModel({
        settings,
        role,
        hasImages: preparedAttachments.images.length > 0,
      }),
      thinking = openRouterModelThinking(attachmentRoute.model),
      rawReasoningEffort = value.reasoningEffort
        ? text(value.reasoningEffort, "thinking level", 20)
        : undefined,
      promptWithAttachments = withChatAttachmentContext(
        prompt,
        preparedAttachments.textBlocks,
      ),
      helpSelection = withProductHelp(
        promptWithAttachments,
        prompt,
        productHelpLibrary,
      );
    if (rawReasoningEffort && !isThinkingEffort(rawReasoningEffort)) {
      preparedAttachments.cleanup();
      throw new Error(
        "The selected thinking level is not supported by this OpenRouter model",
      );
    }
    const reasoningEffort = rawReasoningEffort as ThinkingEffort | undefined;
    if (reasoningEffort && !thinking?.supported.includes(reasoningEffort)) {
      preparedAttachments.cleanup();
      throw new Error(
        "The selected thinking level is not supported by this OpenRouter model",
      );
    }
    assertPreparedChatAttachmentsCurrent(
      workspaceId,
      chatId,
      preparedAttachments.sources,
    );
    let release: () => void;
    try {
      release = openRouterBudget.reserve(settings, usage.summary);
    } catch (error) {
      const provider = settings.fallbackProvider;
      if (provider && subscriptions.includes(provider)) {
        preparedAttachments.cleanup();
        return fallback(
          provider,
          "A concurrent hosted request reserved the remaining cap; using the pre-approved subscription fallback.",
        );
      }
      preparedAttachments.cleanup();
      throw error;
    }
    assertChatMayStart(workspaceId, chatId);
    const runId = store.createHostedRun(
        workspaceId,
        chatId,
        sourceMessageId,
        role,
        attachmentRoute.model,
        securityProfileId,
      ),
      controller = new AbortController();
    const activeHostedRun = {
      workspaceId,
      chatId,
      controller,
      toolRunIds: new Set<string>(),
      completion: undefined as Promise<void> | undefined,
    };
    activeHostedRuns.set(runId, activeHostedRun);
    if (helpSelection.sources.length)
      store.addHostedRunEvent(
        workspaceId,
        runId,
        "progress",
        `Waypoint Help ${helpSelection.helpVersion} · ${helpSelection.sources.map((source) => `${source.title} [${source.sha256.slice(0, 12)}]`).join("; ")}`,
      );
    if (preparedAttachments.receipt)
      store.addHostedRunEvent(
        workspaceId,
        runId,
        "progress",
        `Attachment delivery · ${preparedAttachments.receipt}`,
      );
    if (preparedAttachments.images.length)
      store.addHostedRunEvent(
        workspaceId,
        runId,
        "progress",
        attachmentRoute.reason,
      );
    if (reasoningEffort)
      store.addHostedRunEvent(
        workspaceId,
        runId,
        "provider",
        `Thinking · ${reasoningEffort}`,
      );
    store.startHostedRun(workspaceId, runId);
    const approvedHostedOperations = new Set<string>();
    let nativeAutomationSummary: string | undefined,
      nativeAutomationResult:
        | { proposalId: string; status: string; summary?: string }
        | undefined,
      nativeAutomationInFlight:
        | Promise<{ proposalId: string; status: string; summary?: string }>
        | undefined;
    const onAutomationProposal = async (definition: unknown) => {
      if (nativeAutomationResult) return nativeAutomationResult;
      if (nativeAutomationInFlight) return nativeAutomationInFlight;
      nativeAutomationInFlight = (async () => {
        const proposal = await prepareAutomationProposal(
          workspaceId,
          chatId,
          definition,
        );
        nativeAutomationSummary = automationProposalPreparedSummary(
          proposal.definition,
        );
        nativeAutomationResult = {
          proposalId: proposal.id,
          status: proposal.status,
          summary: nativeAutomationSummary,
        };
        return nativeAutomationResult;
      })();
      try {
        return await nativeAutomationInFlight;
      } finally {
        nativeAutomationInFlight = undefined;
      }
    };
    activeHostedRun.completion = openRouterAgentClient
      .run({
        workspaceId,
        role,
        model: attachmentRoute.model,
        prompt: withAutomationProposalTool({
          prompt: withCurrentDateTime(helpSelection.prompt),
          chatId,
          provider: "openrouter",
          securityProfileId,
        }),
        images: preparedAttachments.hostedImages,
        apiKey,
        signal: controller.signal,
        requestCapMicros: settings.perRequestCapMicros ?? 100_000,
        reasoningEffort: reasoningEffort as ThinkingEffort | undefined,
        tools: hostedTools,
        onToolCall: (call) =>
          store.addHostedRunEvent(
            workspaceId,
            runId,
            "progress",
            `Tool requested · ${call.name}`,
          ),
        onTextDelta: (text) =>
          store.appendHostedAssistantText(workspaceId, runId, text),
        executeTool: async (call) => {
          store.assertWorkspaceExecutionRoot(workspaceId);
          if (call.name === OPENROUTER_AUTOMATION_PROPOSAL_TOOL) {
            try {
              const result = await onAutomationProposal(
                call.arguments.definition,
              );
              return JSON.stringify({ ...result, status: "pending" });
            } catch (error) {
              return JSON.stringify({
                status: "rejected",
                error:
                  error instanceof Error
                    ? error.message
                    : "Automation proposal validation failed",
                provisioned: false,
                enabled: false,
              });
            }
          }
          const request = openRouterToolRequest(
            workspaceId,
            chatId,
            call,
            hostedToolNames,
          );
          const approvalOperation = createHash("sha256")
            .update(`${request.tool}\n${JSON.stringify(request.arguments)}`)
            .digest("hex");
          if (
            automationProfile.approval !== "never" &&
            openRouterToolNeedsApproval(request) &&
            !approvedHostedOperations.has(approvalOperation)
          ) {
            let safeArguments: unknown;
            try {
              safeArguments = JSON.parse(
                redactToolText(
                  JSON.stringify(request.arguments),
                  hostedPolicy.secretNames,
                ),
              );
            } catch {
              safeArguments = "[redacted arguments]";
            }
            const decision = await awaitProviderDecision(
              {
                workspaceId,
                chatId,
                executionId: runId,
                provider: "openrouter",
                request: {
                  providerRequestId: call.id,
                  kind: openRouterToolApprovalKind(request),
                  title: `OpenRouter requests ${request.tool}`,
                  detail: { tool: request.tool, arguments: safeArguments },
                  options: [
                    { id: "decline", label: "Decline" },
                    { id: "allow_once", label: "Allow once" },
                    { id: "allow_session", label: "Allow for session" },
                  ],
                },
              },
              controller.signal,
            );
            if (decision.status === "accepted_session")
              approvedHostedOperations.add(approvalOperation);
            if (!["accepted", "accepted_session"].includes(decision.status))
              return JSON.stringify({
                status: "denied",
                code: "user_declined",
                tool: request.tool,
              });
          }
          if (controller.signal.aborted)
            return JSON.stringify({
              status: "canceled",
              code: "provider_canceled",
              tool: request.tool,
            });
          const activeRun = activeHostedRuns.get(runId),
            execution = await toolGateway.execute(
              request,
              hostedPolicy,
              [],
              (toolRunId) => activeRun?.toolRunIds.add(toolRunId),
            );
          let completed: ToolResult;
          try {
            completed =
              execution.result ??
              (await toolGateway.waitForCompletion(execution.runId));
          } finally {
            activeRun?.toolRunIds.delete(execution.runId);
          }
          store.addHostedRunEvent(
            workspaceId,
            runId,
            "progress",
            `${request.tool} · ${completed.receipt.status}`,
          );
          return JSON.stringify({
            status: completed.receipt.status,
            summary: completed.receipt.summary,
            code: completed.receipt.code,
            output: completed.output,
            value: completed.value,
            receiptId: completed.receipt.id,
          });
        },
      })
      .then(async ({ text: answer, receipt, toolCalls }) => {
        if (toolCalls)
          store.addHostedRunEvent(
            workspaceId,
            runId,
            "progress",
            `${toolCalls} Tool Gateway call${toolCalls === 1 ? "" : "s"} completed`,
          );
        const finalAnswer =
          nativeAutomationSummary && !answer.includes(nativeAutomationSummary)
            ? `${answer}${answer ? "\n\n" : ""}${nativeAutomationSummary}`
            : answer;
        store.finishHostedRun(
          workspaceId,
          runId,
          "completed",
          receipt,
          finalAnswer,
        );
      })
      .catch((error: Error & { receipt?: ProviderUsageReceipt }) => {
        const receipt = error.receipt;
        if (receipt)
          store.finishHostedRun(
            workspaceId,
            runId,
            receipt.status === "canceled" ? "canceled" : "failed",
            receipt,
          );
      })
      .finally(() => {
        preparedAttachments.cleanup();
        providerDecisionGate.clearExecution(runId);
        release();
        activeHostedRuns.delete(runId);
      });
    return {
      runId,
      status: "running",
      model: attachmentRoute.model,
      attachmentDelivery: {
        delivered: attachmentIds,
        mode: preparedAttachments.images.length
          ? "image-and-local-text"
          : preparedAttachments.textBlocks.length
            ? "local-text"
            : "none",
      },
    };
  });
  handle("waypoint:cancel-openrouter-run", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      runId = text(value.runId, "hosted run ID", 64),
      active = activeHostedRuns.get(runId);
    if (!active || active.workspaceId !== workspaceId)
      return { canceled: false };
    active.controller.abort();
    for (const toolRunId of active.toolRunIds)
      toolGateway.cancel(workspaceId, toolRunId);
    return { canceled: true };
  });
  handle("waypoint:tool-gateway-settings", (event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    toolWindowWorkspaces.set(event.sender.id, workspaceId);
    event.sender.once("destroyed", () =>
      toolWindowWorkspaces.delete(event.sender.id),
    );
    return store.toolGatewaySettings(workspaceId);
  });
  handle("waypoint:browser-discovery", () =>
    browserCandidates().map((item) => ({
      id: item.id,
      label: item.label,
      family: item.family,
      installed: item.installed,
      selectable: item.selectable,
      profiles: item.profiles,
      reason: item.reason,
    })),
  );
  handle("waypoint:browser-profile-import", async (event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      browserId = text(value.browserId, "browser ID", 20),
      profileId = text(value.profileId, "browser profile ID", 100),
      browser = selectedBrowser(browserId);
    assertBrowserWorkspace(event, workspaceId);
    if (
      !browser?.profileRoot ||
      !browser.profiles.some((item) => item.id === profileId)
    )
      throw new Error("The selected installed browser profile is unavailable");
    await inAppBrowser.close(workspaceId);
    const closed = await toolGateway.stopAndCloseBrowser(
      workspaceId,
      gatewayPolicy(workspaceId),
    );
    if (!closed && browserClosure)
      throw new Error(
        "Close the active browser session before importing a profile snapshot",
      );
    const source = path.join(browser.profileRoot, profileId),
      profileName = `${browserId}.${profileId.replaceAll(" ", "_")}`,
      root = path.join(
        app.getPath("userData"),
        "browser-profile-snapshots",
        workspaceId,
      ),
      target = path.join(root, profileName),
      { bytes, files } = snapshotBrowserProfile({
        source,
        target,
        browserId,
        profileId,
        localStatePath: path.join(browser.profileRoot, "Local State"),
      });
    const current = store.toolGatewaySettings(workspaceId),
      settings = store.setToolGatewaySettings(workspaceId, {
        ...current,
        browserProfileMode: "existing",
        browserProfileName: profileName,
      });
    if (!settings.stopped) toolGateway.resume(workspaceId);
    return {
      settings,
      profile: {
        browserId,
        profileId,
        bytes,
        files,
        warning:
          "Waypoint uses a private snapshot. The original browser profile is never driven or modified; later browser changes require an explicit refresh.",
      },
    };
  });
  handle("waypoint:browser-profile-remove", async (event, input: unknown) => {
    const workspaceId = text(
        (input as Record<string, unknown>).workspaceId,
        "workspace ID",
        64,
      ),
      current = store.toolGatewaySettings(workspaceId),
      profileName = current.browserProfileName;
    assertBrowserWorkspace(event, workspaceId);
    await inAppBrowser.close(workspaceId);
    const closed = await toolGateway.stopAndCloseBrowser(
      workspaceId,
      gatewayPolicy(workspaceId),
    );
    if (!closed && browserClosure)
      throw new Error(
        "Close the active browser session before removing its private snapshot",
      );
    if (current.browserProfileMode === "existing" && profileName)
      rmSync(
        path.join(
          app.getPath("userData"),
          "browser-profile-snapshots",
          workspaceId,
          path.basename(profileName),
        ),
        { recursive: true, force: true },
      );
    const settings = store.setToolGatewaySettings(workspaceId, {
      ...current,
      browserProfileMode: "isolated",
      browserProfileName: "waypoint-isolated",
    });
    if (!settings.stopped) toolGateway.resume(workspaceId);
    return { removed: true as const, settings };
  });
  handle("waypoint:in-app-browser-status", (event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    assertBrowserWorkspace(event, workspaceId);
    return inAppBrowser.status(workspaceId);
  });
  handle("waypoint:in-app-browser-open", async (event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      url = text(value.url, "browser URL", 2048),
      bounds = value.bounds as {
        x: number;
        y: number;
        width: number;
        height: number;
      },
      host = BrowserWindow.fromWebContents(event.sender),
      settings = store.toolGatewaySettings(workspaceId);
    assertBrowserWorkspace(event, workspaceId);
    if (
      !host ||
      settings.browserProfileMode !== "isolated" ||
      !settings.browserAllowedDomains.length
    )
      throw new Error(
        "Enable the isolated browser and at least one public domain in Settings",
      );
    return inAppBrowser.open(
      workspaceId,
      host,
      url,
      settings.browserAllowedDomains,
      bounds,
    );
  });
  handle("waypoint:in-app-browser-bounds", (event, input: unknown) => {
    const value = input as Record<string, unknown>;
    const workspaceId = text(value.workspaceId, "workspace ID", 64);
    assertBrowserWorkspace(event, workspaceId);
    inAppBrowser.bounds(
      workspaceId,
      value.bounds as { x: number; y: number; width: number; height: number },
    );
    return { updated: true };
  });
  handle("waypoint:in-app-browser-navigate", (event, input: unknown) => {
    const value = input as Record<string, unknown>,
      command = String(value.command);
    const workspaceId = text(value.workspaceId, "workspace ID", 64);
    assertBrowserWorkspace(event, workspaceId);
    if (!["back", "forward", "reload", "stop"].includes(command))
      throw new Error("browser_navigation_invalid");
    return inAppBrowser.navigate(
      workspaceId,
      command as "back" | "forward" | "reload" | "stop",
    );
  });
  handle("waypoint:in-app-browser-close", (event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    assertBrowserWorkspace(event, workspaceId);
    return inAppBrowser.close(workspaceId);
  });
  handle("waypoint:in-app-browser-hide", (event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    assertBrowserWorkspace(event, workspaceId);
    return inAppBrowser.hide(workspaceId);
  });
  handle("waypoint:in-app-browser-clear", (event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    assertBrowserWorkspace(event, workspaceId);
    return inAppBrowser.clear(workspaceId);
  });
  handle("waypoint:web-tools-update", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      current = store.toolGatewaySettings(workspaceId);
    return store.setToolGatewaySettings(workspaceId, {
      ...current,
      webFetchEnabled: value.webFetchEnabled === true,
      webSearchEnabled:
        value.webSearchEnabled === true && webSearchVault.hasKey(),
    });
  });
  handle(
    "waypoint:tool-gateway-update-settings",
    async (_event, input: unknown) => {
      const value = input as Record<string, unknown>,
        workspaceId = text(value.workspaceId, "workspace ID", 64),
        current = store.toolGatewaySettings(workspaceId),
        priorPolicy = gatewayPolicy(workspaceId),
        denyPatterns = Array.isArray(value.denyPatterns)
          ? value.denyPatterns.map((item) => text(item, "deny pattern", 300))
          : [],
        browserAllowedDomains = Array.isArray(value.browserAllowedDomains)
          ? value.browserAllowedDomains.map((item) =>
              text(item, "browser domain", 253),
            )
          : [],
        next = {
          stopped: value.stopped === true,
          denyPatterns,
          suppressCommit: value.suppressCommit === true,
          suppressPush: value.suppressPush === true,
          browserProfileMode:
            value.browserProfileMode === "existing"
              ? ("existing" as const)
              : ("isolated" as const),
          browserProfileName: text(
            value.browserProfileName ?? "Default",
            "browser profile",
            100,
          ),
          browserAllowedDomains,
        };
      validatePolicy({ ...priorPolicy, ...next });
      const browserAuthorityChanged =
        current.browserProfileMode !== next.browserProfileMode ||
        current.browserProfileName !== next.browserProfileName ||
        JSON.stringify(current.browserAllowedDomains) !==
          JSON.stringify(next.browserAllowedDomains);
      if (next.stopped || browserAuthorityChanged) {
        await inAppBrowser.close(workspaceId);
        const closed = await toolGateway.stopAndCloseBrowser(
          workspaceId,
          priorPolicy,
        );
        if (!closed && browserClosure)
          throw new Error(
            "Browser session could not be proven closed; policy was not changed",
          );
      }
      if (next.stopped) {
        for (const active of activeAutoTitles.values())
          if (active.workspaceId === workspaceId) active.cancel();
        const reflectionRun = activeReflectionRuns.get(workspaceId);
        if (reflectionRun) {
          killedReflectionWorkspaces.add(workspaceId);
          workbench.cancel(`reflection-${reflectionRun}`);
        }
        store.cancelAllRemoteJobs(workspaceId);
        voiceOperations.stop(workspaceId);
        if (voiceSpeechOwner?.workspaceId === workspaceId) {
          const owner = voiceSpeechOwner;
          fastVoiceSpeech.stop();
          voiceSpeechOwner = undefined;
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send("waypoint:voice-audio-stop", {
              workspaceId,
              chatId: owner.chatId,
              turnId: owner.turnId,
            });
          owner.notify("canceled");
        }
        const capture = store.activityCapturePolicy(workspaceId);
        if (capture.enabled && !capture.paused)
          store.setActivityCapturePolicy(workspaceId, {
            ...capture,
            paused: true,
          });
      } else toolGateway.resume(workspaceId);
      return store.setToolGatewaySettings(workspaceId, next);
    },
  );
  handle(
    "waypoint:tool-gateway-clear-browser-data",
    async (_event, input: unknown) => {
      const workspaceId = text(
          (input as Record<string, unknown>).workspaceId,
          "workspace ID",
          64,
        ),
        target = path.join(
          app.getPath("userData"),
          "browser-sessions",
          workspaceId,
        ),
        closed = await toolGateway.stopAndCloseBrowser(
          workspaceId,
          gatewayPolicy(workspaceId),
        );
      if (!closed && browserClosure)
        throw new Error(
          "Browser session could not be proven closed; isolated data was not cleared",
        );
      rmSync(target, { recursive: true, force: true });
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      if (!store.toolGatewaySettings(workspaceId).stopped)
        toolGateway.resume(workspaceId);
      return { cleared: true };
    },
  );
  handle("waypoint:tool-gateway-receipts", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.listToolReceipts(
      text(value.workspaceId, "workspace ID", 64),
      Number(value.limit ?? 100),
    );
  });
  handle("waypoint:tool-failures", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.listToolFailures(
      text(value.workspaceId, "workspace ID", 64),
      Number(value.limit ?? 100),
    );
  });
  handle("waypoint:delete-tool-failure", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return {
      deleted: store.deleteToolFailure(
        text(value.workspaceId, "workspace ID", 64),
        text(value.id, "failure knowledge ID", 64),
      ),
    };
  });
  handle("waypoint:tool-gateway-execute", async (event, input: unknown) => {
    const request = input as ToolRequest,
      workspaceId = text(request?.workspaceId, "workspace ID", 64);
    toolWindowWorkspaces.set(event.sender.id, workspaceId);
    return toolGateway.execute(
      { ...request, origin: "ui" },
      gatewayPolicy(workspaceId),
    );
  });
  handle("waypoint:tool-gateway-cancel", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return {
      canceled: toolGateway.cancel(
        text(value.workspaceId, "workspace ID", 64),
        text(value.runId, "tool run ID", 64),
      ),
    };
  });
  handle("waypoint:create-workspace", (_event, input: unknown) => {
    const name = text(
      (input as { name?: unknown })?.name,
      "workspace name",
      120,
    ).trim();
    if (!name) throw new Error("Workspace name is required");
    return store.createWorkspace(name, app.getPath("userData"));
  });
  handle(
    "waypoint:choose-workspace-execution-root",
    async (_event, input: unknown) => {
      const workspaceId = text(
          (input as Record<string, unknown>).workspaceId,
          "workspace ID",
          64,
        ),
        workspace = store
          .listWorkspaces()
          .find((item) => item.id === workspaceId);
      if (!workspace) throw new Error("Workspace not found");
      if (
        store.activeExecutionIds(workspaceId).length ||
        activeAutomationWorkspaces.has(workspaceId) ||
        activeAutomationProvisioningWorkspaces.has(workspaceId) ||
        activeReflectionRuns.has(workspaceId) ||
        [...activeHostedRuns.values()].some(
          (run) => run.workspaceId === workspaceId,
        )
      )
        throw new Error(
          "Wait for active AI work or connector provisioning to finish before changing the repository root",
        );
      const chosen = await dialog.showOpenDialog({
        title:
          "Choose the repository or working folder Waypoint agents may use",
        defaultPath: workspace.executionRoot ?? app.getPath("documents"),
        properties: ["openDirectory", "createDirectory"],
      });
      if (chosen.canceled || chosen.filePaths.length !== 1)
        return { canceled: true, workspace };
      return {
        canceled: false,
        workspace: store.setWorkspaceExecutionRoot(
          workspaceId,
          chosen.filePaths[0],
        ),
      };
    },
  );
  handle(
    "waypoint:clear-workspace-execution-root",
    (_event, input: unknown) => {
      const workspaceId = text(
        (input as Record<string, unknown>).workspaceId,
        "workspace ID",
        64,
      );
      if (
        store.activeExecutionIds(workspaceId).length ||
        activeAutomationWorkspaces.has(workspaceId) ||
        activeAutomationProvisioningWorkspaces.has(workspaceId) ||
        activeReflectionRuns.has(workspaceId) ||
        [...activeHostedRuns.values()].some(
          (run) => run.workspaceId === workspaceId,
        )
      )
        throw new Error(
          "Wait for active AI work or connector provisioning to finish before changing the repository root",
        );
      return store.setWorkspaceExecutionRoot(workspaceId);
    },
  );
  handle("waypoint:delete-workspace", async (_event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    const workspaces = store.listWorkspaces();
    if (!workspaces.some((item) => item.id === workspaceId))
      throw new Error("Workspace not found");
    if (workspaces.length <= 1)
      throw new Error("Waypoint must keep at least one workspace");
    if (
      [...activeDocumentIndexes].some((key) =>
        key.startsWith(`${workspaceId}:`),
      )
    )
      throw new Error(
        "Wait for document indexing to finish before deleting this workspace",
      );
    if (
      activeSyncRuns.has(workspaceId) ||
      activeWebhookRuns.has(workspaceId) ||
      activeAutomationWorkspaces.has(workspaceId) ||
      activeAutomationProvisioningWorkspaces.has(workspaceId) ||
      activeReflectionRuns.has(workspaceId) ||
      [...activeHostedRuns.values()].some(
        (run) => run.workspaceId === workspaceId,
      ) ||
      [...meetingTranscriptionRuns.values()].some(
        (run) => run.workspaceId === workspaceId,
      ) ||
      [...activeRemoteExecutions.values()].some(
        (run) => run.workspaceId === workspaceId,
      ) ||
      store
        .listExecutions(workspaceId)
        .some((run) => run.status === "running") ||
      store
        .listToolReceipts(workspaceId)
        .some((run) => run.status === "running") ||
      voiceOperations.countFor(workspaceId) > 0 ||
      voiceSpeechOwner?.workspaceId === workspaceId
    )
      throw new Error(
        "Stop active workspace operations before deleting this workspace",
      );
    const browserClosed = await toolGateway.stopAndCloseBrowser(
      workspaceId,
      gatewayPolicy(workspaceId),
    );
    if (!browserClosed && browserClosure)
      throw new Error(
        "Close the active browser session before deleting this workspace",
      );
    voiceOperations.stop(workspaceId);
    if (voiceSpeechOwner?.workspaceId === workspaceId) {
      fastVoiceSpeech.stop();
      voiceSpeechOwner = undefined;
    }
    const capture = store.activityCapturePolicy(workspaceId);
    if (capture.enabled && !capture.paused)
      store.setActivityCapturePolicy(workspaceId, { ...capture, paused: true });
    if (peerHostRuntime.status().workspaceId === workspaceId)
      await peerHostRuntime.stop();
    for (const active of activeAutoTitles.values())
      if (active.workspaceId === workspaceId) active.cancel();
    const workspace = store.deleteWorkspace(workspaceId);
    try {
      syncVault.remove(workspaceId);
    } catch {
      console.warn(
        "Workspace deleted, but protected sync residue requires maintenance cleanup",
      );
    }
    for (const root of ["browser-sessions", "peer-host"])
      try {
        rmSync(path.join(app.getPath("userData"), root, workspaceId), {
          recursive: true,
          force: true,
        });
      } catch {
        console.warn(
          `Workspace deleted, but ${root} residue requires maintenance cleanup`,
        );
      }
    return workspace;
  });
  handle("waypoint:create-document", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.createDocument(
      text(value.workspaceId, "workspace ID", 64),
      text(value.title, "title", 300),
      text(value.body, "body", 2_000_000),
    );
  });
  handle("waypoint:capture-message-as-document", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.captureMessageAsDocument(
      text(value.workspaceId, "workspace ID", 64),
      text(value.messageId, "message ID", 64),
    );
  });
  handle("waypoint:update-document", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.updateDocument(
      text(value.workspaceId, "workspace ID", 64),
      text(value.objectId, "document ID", 64),
      text(value.title, "title", 300),
      text(value.body, "body", 2_000_000),
    );
  });
  handle("waypoint:list-documents", (_event, input: unknown) =>
    store.listDocuments(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:import-document", async (_event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    if (!store.listWorkspaces().some((item) => item.id === workspaceId))
      throw new Error("Workspace not found");
    const chosen = await dialog.showOpenDialog({
      title: "Import local document",
      properties: ["openFile"],
      filters: [
        {
          name: "Documents",
          extensions: ["pdf", "docx", "txt", "md", "markdown"],
        },
      ],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
    const sourcePath = chosen.filePaths[0],
      mediaType =
        ATTACHMENT_MEDIA_BY_EXTENSION[path.extname(sourcePath).toLowerCase()];
    if (!mediaType || mediaType.startsWith("image/"))
      throw new Error("This file type has no approved local text extractor");
    readAndValidateAttachment(sourcePath, path.basename(sourcePath), mediaType);
    const extracted = await extractDocumentOffMain(sourcePath, mediaType);
    if (extracted.status === "failed")
      return {
        canceled: false,
        state: "failed",
        code: extracted.code,
        message: extracted.message,
      };
    const title =
        path
          .basename(extracted.fileName, path.extname(extracted.fileName))
          .slice(0, 300) || "Imported document",
      document = store.createDocument(workspaceId, title, extracted.text);
    let attachmentId: string;
    try {
      attachmentId = store.addAttachment(
        workspaceId,
        document.id,
        extracted.fileName,
        mediaType,
        sourcePath,
      );
      store.registerDocumentImportSource(workspaceId, {
        documentId: document.id,
        revisionId: document.revisionId,
        attachmentId,
        sourceDigest: extracted.sourceDigest,
        textDigest: createHash("sha256").update(extracted.text).digest("hex"),
        extractor: extracted.extractor,
        extractorVersion: extracted.extractorVersion,
      });
      const stored = store.documentSource(workspaceId, document.id);
      if (stored.metadata.sha256 !== extracted.sourceDigest)
        throw new Error("The selected file changed during import");
    } catch (error) {
      store.deleteObject(workspaceId, "document", document.id);
      throw error;
    }
    const base = {
      canceled: false,
      documentId: document.id,
      revisionId: document.revisionId,
      attachmentId,
      sourceName: extracted.fileName,
      extractor: extracted.extractor,
      extractorVersion: extracted.extractorVersion,
      warnings: extracted.warnings,
    };
    try {
      return {
        ...base,
        ...(await indexImportedDocument(
          workspaceId,
          document.id,
          document.revisionId,
          attachmentId,
          extracted.chunks,
        )),
      };
    } catch {
      return {
        ...base,
        state: "index_failed" as const,
        chunkCount: extracted.chunks.length,
        provider: embeddings.provider,
        model: embeddings.model,
        message:
          "The document was imported for lexical search, but local semantic indexing failed. Retry from Knowledge after checking the local embedding runtime.",
      };
    }
  });
  handle(
    "waypoint:reindex-imported-document",
    async (_event, input: unknown) => {
      const value = input as Record<string, unknown>,
        workspaceId = text(value.workspaceId, "workspace ID", 64),
        documentId = text(value.documentId, "document ID", 64),
        document = store
          .listDocuments(workspaceId)
          .find((item) => item.id === documentId);
      if (!document) throw new Error("Document not found in workspace");
      const source = store.documentSource(workspaceId, documentId),
        extracted = await extractDocumentOffMain(
          source.absolutePath,
          source.metadata.mediaType,
        );
      if (extracted.status === "failed")
        return {
          state: extracted.code === "busy" ? "index_busy" : "index_failed",
          chunkCount: 0,
          provider: embeddings.provider,
          model: embeddings.model,
          message: extracted.message,
        };
      if (
        extracted.sourceDigest !== source.metadata.sha256 ||
        extracted.text !== document.body
      )
        return {
          state: "source_changed",
          chunkCount: extracted.chunks.length,
          provider: embeddings.provider,
          model: embeddings.model,
          message:
            "This document was edited after import. Reindexing the original source would create false provenance; import the edited file as a new document instead.",
        };
      try {
        return await indexImportedDocument(
          workspaceId,
          documentId,
          document.revisionId,
          source.metadata.id,
          extracted.chunks,
        );
      } catch {
        return {
          state: "index_failed",
          chunkCount: extracted.chunks.length,
          provider: embeddings.provider,
          model: embeddings.model,
          message:
            "Local semantic indexing failed without replacing the last complete index generation.",
        };
      }
    },
  );
  handle("waypoint:document-index-status", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.documentIndexStatus(
      text(value.workspaceId, "workspace ID", 64),
      text(value.documentId, "document ID", 64),
    );
  });
  handle("waypoint:rollback-document-index", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.rollbackDocumentIndex(
      text(value.workspaceId, "workspace ID", 64),
      text(value.documentId, "document ID", 64),
    );
  });
  handle("waypoint:sync-status", (_event, input: unknown) =>
    sanitizeSyncStatus(
      store.syncStatus(
        text(
          (input as Record<string, unknown>).workspaceId,
          "workspace ID",
          64,
        ),
      ),
    ),
  );
  handle("waypoint:desktop-sync-status", (_event, input: unknown) =>
    syncService.status(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:desktop-sync-host-start", async (_event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    return {
      canceled: false,
      ...(await syncService.startPeerHost(workspaceId)),
    };
  });
  handle("waypoint:desktop-sync-host-stop", async (_event, input: unknown) =>
    syncService.stopPeerHost(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:desktop-sync-initialize", async (_event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    if (!store.listWorkspaces().some((item) => item.id === workspaceId))
      throw new Error("Workspace not found");
    const bootstrap = syncService.initializeOwner(workspaceId);
    store.configureSyncDevice(workspaceId, bootstrap.deviceId);
    recordSyncActivityBestEffort(store, workspaceId, "device.initialized");
    return { canceled: false, bootstrap };
  });
  handle(
    "waypoint:desktop-sync-create-invitation",
    async (_event, input: unknown) =>
      syncService.createInvitation(
        text(
          (input as Record<string, unknown>).workspaceId,
          "workspace ID",
          64,
        ),
      ),
  );
  handle(
    "waypoint:desktop-sync-submit-enrollment",
    async (_event, input: unknown) =>
      syncService.submitEnrollment(
        text(
          (input as Record<string, unknown>).token,
          "enrollment token",
          8192,
        ),
      ),
  );
  handle(
    "waypoint:desktop-sync-complete-enrollment",
    async (_event, input: unknown) => {
      const workspaceId = text(
          (input as Record<string, unknown>).workspaceId,
          "workspace ID",
          64,
        ),
        result = await syncService.completeEnrollment(workspaceId);
      store.configureSyncDevice(workspaceId, result.deviceId);
      recordSyncActivityBestEffort(store, workspaceId, "device.enrolled");
      return result;
    },
  );
  handle("waypoint:desktop-sync-pending", async (_event, input: unknown) =>
    syncService.pendingEnrollments(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:desktop-sync-approve", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      requestId = text(value.requestId, "request ID", 64);
    const result = await syncService.approveEnrollment(workspaceId, requestId);
    recordSyncActivityBestEffort(store, workspaceId, "device.approved");
    return { canceled: false, ...result };
  });
  handle("waypoint:desktop-sync-devices", async (_event, input: unknown) =>
    syncService.devices(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:desktop-sync-revoke", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      deviceId = text(value.deviceId, "device ID", 64);
    await syncService.revoke(workspaceId, deviceId);
    const rotation = await syncService.rotate(workspaceId);
    recordSyncActivityBestEffort(store, workspaceId, "device.revoked");
    recordSyncActivityBestEffort(store, workspaceId, "key.rotated");
    return { canceled: false, rotation };
  });
  handle(
    "waypoint:desktop-sync-resume-rotation",
    async (_event, input: unknown) => {
      const workspaceId = text(
          (input as Record<string, unknown>).workspaceId,
          "workspace ID",
          64,
        ),
        result = await syncService.rotate(workspaceId);
      recordSyncActivityBestEffort(store, workspaceId, "key.rotated");
      return result;
    },
  );
  handle("waypoint:desktop-sync-now", async (_event, input: unknown) => {
    const workspaceId = text(
        (input as Record<string, unknown>).workspaceId,
        "workspace ID",
        64,
      ),
      result = await syncService.syncOnce(workspaceId, store);
    await processRemoteJobs(workspaceId);
    recordSyncActivityBestEffort(store, workspaceId, "sync.completed", {
      status: "completed",
    });
    return result;
  });
  handle("waypoint:device-control-status", async (_event, input: unknown) => {
    const workspaceId = text(
        (input as Record<string, unknown>).workspaceId,
        "workspace ID",
        64,
      ),
      [codex, claude, grok] = await Promise.all([
        detectCli("codex"),
        detectCli("claude"),
        detectCli("grok"),
      ]);
    return {
      policy: store.deviceControlPolicy(workspaceId),
      jobs: store.listRemoteJobs(workspaceId),
      sync: syncService.status(workspaceId),
      capabilities: [
        {
          id: "waypoint.workspace_summary",
          available: true,
          label: "Workspace summary",
        },
        {
          id: "agent.codex",
          available: codex.available,
          label: "Codex agent",
          reason: codex.available
            ? "Bounded target-local signed-in CLI delegation is ready."
            : "Codex CLI is unavailable on this device.",
        },
        {
          id: "agent.claude",
          available: claude.available,
          label: "Claude agent",
          reason: claude.available
            ? "Bounded target-local signed-in CLI delegation is ready."
            : "Claude CLI is unavailable on this device.",
        },
        {
          id: "agent.grok",
          available: grok.available,
          label: "Grok Build agent",
          reason: grok.available
            ? "Bounded target-local signed-in CLI delegation is ready."
            : "Grok Build CLI is unavailable on this device.",
        },
      ],
    };
  });
  handle("waypoint:device-control-update", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      current = store.deviceControlPolicy(workspaceId),
      next = {
        ...current,
        ...(value.policy as Record<string, unknown>),
        version: 1,
      };
    if (JSON.stringify(next) === JSON.stringify(current))
      return { canceled: false, policy: current };
    return {
      canceled: false,
      policy: store.setDeviceControlPolicy(workspaceId, next as never),
    };
  });
  handle("waypoint:device-control-dispatch", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      targetDeviceId = text(value.targetDeviceId, "target device ID", 128),
      instruction = text(value.instruction, "remote instruction", 8000),
      capability = ["agent.codex", "agent.claude", "agent.grok"].includes(
        String(value.capability),
      )
        ? (String(value.capability) as
            "agent.codex" | "agent.claude" | "agent.grok")
        : "waypoint.workspace_summary",
      sync = syncService.status(workspaceId);
    if (!sync.configured || !sync.deviceId)
      throw new Error("Device sync is not configured");
    return store.createRemoteJobRecord({
      workspaceId,
      controllerDeviceId: sync.deviceId,
      targetDeviceId,
      capability,
      instruction,
      idempotencyKey: text(value.idempotencyKey, "idempotency key", 128),
      profileDigest: remotePolicyDigest(capability),
      keyEpoch: sync.keyEpoch,
      timeoutMs:
        capability === "agent.codex" ||
        capability === "agent.claude" ||
        capability === "agent.grok"
          ? 0
          : 60_000,
    });
  });
  handle("waypoint:device-control-cancel", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      jobId = text(value.jobId, "remote job ID", 128),
      active = activeRemoteExecutions.get(jobId);
    if (active?.workspaceId === workspaceId) {
      if (active.provider === "grok") grokWorkbench.cancel(active.runId);
      else workbench.cancel(active.runId);
    }
    return { canceled: store.cancelRemoteJob(workspaceId, jobId) };
  });
  handle("waypoint:device-control-delete", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteRemoteJob(
      text(value.workspaceId, "workspace ID", 64),
      text(value.jobId, "remote job ID", 128),
    );
    return { deleted: true };
  });
  handle("waypoint:webhook-channels", async (_event, input: unknown) =>
    syncService.webhookChannels(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:webhook-channel-create", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      label = text(value.label, "channel label", 80).trim(),
      connectorId = text(
        value.connectorId ?? "generic",
        "webhook connector",
        40,
      );
    if (!label) throw new Error("Channel label is required");
    if (connectorId === "stripe" || connectorId === "resend")
      throw new Error(
        "Stripe and Resend webhook setup is unavailable until provider signing-secret import is implemented",
      );
    return withWorkspaceReservation(
      activeAutomationProvisioningWorkspaces,
      workspaceId,
      "inbound channel mutation",
      () => syncService.createWebhookChannel(workspaceId, label, connectorId),
    );
  });
  handle("waypoint:webhook-channel-rotate", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      channelId = text(value.channelId, "channel ID", 128);
    return withWorkspaceReservation(
      activeAutomationProvisioningWorkspaces,
      workspaceId,
      "inbound channel mutation",
      () => syncService.rotateWebhookChannel(workspaceId, channelId),
    );
  });
  handle("waypoint:webhook-channel-revoke", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      channelId = text(value.channelId, "channel ID", 128);
    return withWorkspaceReservation(
      activeAutomationProvisioningWorkspaces,
      workspaceId,
      "inbound channel mutation",
      () => syncService.revokeWebhookChannel(workspaceId, channelId),
    );
  });
  handle("waypoint:webhook-channel-delete", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      channelId = text(value.channelId, "channel ID", 128);
    return withWorkspaceReservation(
      activeAutomationProvisioningWorkspaces,
      workspaceId,
      "inbound channel mutation",
      () => syncService.deleteWebhookChannel(workspaceId, channelId),
    );
  });
  handle("waypoint:webhook-kill", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    if (typeof value.active !== "boolean")
      throw new Error("Kill state is invalid");
    const workspaceId = text(value.workspaceId, "workspace ID", 64);
    return withWorkspaceReservation(
      activeAutomationProvisioningWorkspaces,
      workspaceId,
      "inbound channel mutation",
      () => syncService.setWebhookKill(workspaceId, value.active as boolean),
    );
  });
  handle("waypoint:webhook-fetch", async (_event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    return withWorkspaceReservation(
      activeWebhookRuns,
      workspaceId,
      "inbound fetch",
      async () => {
        const result = await syncService.fetchWebhookEvents(workspaceId, store);
        await processAutomationRunsV2(workspaceId);
        return result;
      },
    );
  });
  handle("waypoint:webhook-events", (_event, input: unknown) =>
    store.listExternalInboundEvents(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:webhook-connectors", () => WEBHOOK_CONNECTORS);
  handle("waypoint:automation-proposals", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId =
        value.chatId === undefined
          ? undefined
          : text(value.chatId, "chat ID", 64);
    return store.listAutomationProposals(workspaceId, chatId);
  });
  handle("waypoint:automation-rules-runs", (_event, input: unknown) =>
    store.listAutomationRulesAndRuns(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:automation-rule-status", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      ruleId = text(value.ruleId, "automation rule ID", 64),
      status = value.enabled === true ? "enabled" : "killed";
    store.setAutomationRuleStatus(workspaceId, ruleId, status);
    if (status === "enabled") void processAutomationRunsV2(workspaceId);
    return { ok: true };
  });
  handle("waypoint:automation-run-cancel", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      runId = text(value.runId, "automation run ID", 64),
      run = store
        .listAutomationRulesAndRuns(workspaceId)
        .runs.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found");
    if (run.status === "queued")
      store.cancelQueuedAutomationRun(workspaceId, runId);
    else if (run.status === "running" && run.executionId) {
      const executionId = String(run.executionId),
        provider = activeNativeAutomationExecutions.get(executionId),
        canceled =
          provider === "codex"
            ? codexWorkbench.cancel(executionId)
            : provider === "claude"
              ? claudeWorkbench.cancel(executionId)
              : provider === "grok"
                ? grokWorkbench.cancel(executionId)
                : workbench.cancel(executionId);
      if (!canceled)
        throw new Error("Automation execution is no longer active");
    } else if (run.status === "running")
      throw new Error(
        "Automation run is starting; try cancel again in a moment",
      );
    else throw new Error("Automation run is already complete");
    return { ok: true };
  });
  handle(
    "waypoint:automation-proposal-decide",
    async (_event, input: unknown) => {
      const value = input as Record<string, unknown>,
        decision = String(value.decision);
      if (decision !== "approve" && decision !== "reject")
        throw new Error("Automation decision is invalid");
      const workspaceId = text(value.workspaceId, "workspace ID", 64),
        proposalId = text(value.proposalId, "proposal ID", 64),
        proposalDigest = text(value.proposalDigest, "proposal digest", 64),
        reserved = decision === "approve";
      if (reserved) {
        if (activeAutomationProvisioningWorkspaces.has(workspaceId))
          throw new Error(
            "Another connector provisioning operation is already active for this workspace",
          );
        activeAutomationProvisioningWorkspaces.add(workspaceId);
      }
      try {
        const proposal = store.decideAutomationProposal(
          workspaceId,
          proposalId,
          proposalDigest,
          decision,
        );
        if (decision === "reject") return proposal;
        const planned = proposal.definition.delivery;
        if (!planned.channelId || !planned.endpoint)
          return store.finishAutomationProvisioning(
            workspaceId,
            proposalId,
            proposalDigest,
            {
              status: "failed",
              summary:
                "Configure desktop sync or a hosted relay, then create a fresh proposal for approval.",
            },
          );
        if (
          proposal.definition.trigger.connectorId !== "generic" &&
          planned.reachability !== "public_relay"
        )
          return store.finishAutomationProvisioning(
            workspaceId,
            proposalId,
            proposalDigest,
            {
              status: "failed",
              summary:
                "This cloud provider requires a public trusted HTTPS relay. The approved local-network endpoint was not mutated.",
            },
          );
        if (
          proposal.definition.trigger.connectorId === "stripe" ||
          proposal.definition.trigger.connectorId === "resend"
        )
          return store.finishAutomationProvisioning(
            workspaceId,
            proposalId,
            proposalDigest,
            {
              status: "failed",
              summary: `${proposal.definition.trigger.connectorId} signing-secret import is not configured in this build. No channel or provider endpoint was created.`,
            },
          );
        if (proposal.definition.trigger.connectorId === "generic")
          return store.finishAutomationProvisioning(
            workspaceId,
            proposalId,
            proposalDigest,
            {
              status: "failed",
              summary:
                "Generic senders require manual inbound-channel setup and a one-time signing-secret handoff. No channel, sender, or automation rule was created; configure and verify the sender first, then create a new automation proposal.",
            },
          );
        store.beginAutomationProvisioning(
          workspaceId,
          proposalId,
          proposalDigest,
        );
        let delivery:
            | {
                channelId: string;
                endpoint: string;
                reachability: "public_relay" | "local_network";
              }
            | undefined,
          providerMutation: Record<string, unknown> | undefined;
        try {
          const channel = await syncService.createWebhookChannel(
            workspaceId,
            proposal.definition.title,
            proposal.definition.trigger.connectorId,
            planned.channelId,
          );
          delivery = {
            channelId: channel.channelId,
            endpoint: channel.endpoint,
            reachability:
              channel.transportMode === "hosted-relay"
                ? "public_relay"
                : "local_network",
          };
          if (
            delivery.channelId !== planned.channelId ||
            delivery.endpoint !== planned.endpoint ||
            delivery.reachability !== planned.reachability
          )
            throw new Error(
              "Created webhook delivery does not match the approved proposal",
            );
          store.checkpointAutomationProvisioning(
            workspaceId,
            proposalId,
            proposalDigest,
            {
              executed: true,
              outcome: "partial",
              summary:
                "Waypoint inbound channel created; provider configuration is pending.",
              delivery,
              rollback: {
                waypoint: {
                  operation: "revoke_and_delete_channel",
                  channelId: delivery.channelId,
                },
              },
            },
          );
          const definition = proposal.definition,
            { secret } = syncService.webhookProvisioningSecret(
              workspaceId,
              channel.channelId,
            ),
            policy = gatewayPolicy(workspaceId),
            providerInspection = {
              operation: "inspect_and_delete_exact_endpoint",
              connectorId: definition.trigger.connectorId,
              endpoint: delivery.endpoint,
              organization: definition.provisioning.organization,
              repository:
                definition.provisioning.repositoryFullName ??
                definition.provisioning.repository,
            };
          store.checkpointAutomationProvisioning(
            workspaceId,
            proposalId,
            proposalDigest,
            {
              executed: true,
              outcome: "uncertain",
              summary:
                "Provider mutation attempt is starting; final provider outcome has not been reconciled.",
              delivery,
              rollback: {
                waypoint: {
                  operation: "revoke_and_delete_channel",
                  channelId: delivery.channelId,
                },
                provider: providerInspection,
              },
            },
          );
          const result = await provisionConnector({
            definition,
            secret,
            workspaceRoot: path.join(
              app.getPath("userData"),
              "automation-provisioning-tmp",
            ),
            execute: async (cli, args) => {
              const execution = await toolGateway.execute(
                  {
                    version: 1,
                    workspaceId,
                    origin: "ui",
                    tool: "local_cli.run",
                    arguments: { cli, args, cwd: "." },
                  },
                  policy,
                  [secret],
                ),
                completed =
                  execution.result ??
                  (await toolGateway.waitForCompletion(execution.runId)),
                receipt = completed.receipt;
              if (receipt.status !== "completed")
                throw new Error(
                  receipt.summary ?? `${cli} connector provisioning failed`,
                );
              return completed.output ?? JSON.stringify(completed.value ?? {});
            },
          });
          providerMutation = {
            connectorId: result.connectorId,
            externalId: result.externalId,
            targetIdentity: result.targetIdentity,
            rollback: result.rollback,
          };
          const rollback = {
            waypoint: {
              operation: "revoke_and_delete_channel",
              channelId: delivery.channelId,
            },
            provider: result.rollback,
          };
          store.checkpointAutomationProvisioning(
            workspaceId,
            proposalId,
            proposalDigest,
            {
              executed: true,
              outcome: "partial",
              summary:
                "Provider hook and Waypoint channel were created; final receipt is pending.",
              delivery,
              externalId: result.externalId,
              providerMutation,
              rollback,
            },
          );
          return store.finishAutomationProvisioning(
            workspaceId,
            proposalId,
            proposalDigest,
            {
              status: "applied",
              summary: result.summary,
              externalId: result.externalId,
              rollback,
              delivery,
            },
          );
        } catch (error) {
          if (
            store.automationProposal(workspaceId, proposalId).status !==
            "approved"
          )
            throw error;
          const summary =
              error instanceof Error
                ? error.message
                : "Connector provisioning failed",
            details = error as {
              waypointMutation?: Record<string, unknown>;
              providerMutation?: Record<string, unknown>;
            },
            waypointMutation = details.waypointMutation,
            provider = providerMutation ?? details.providerMutation,
            uncertain =
              /outcome is uncertain/i.test(summary) ||
              waypointMutation?.outcome === "uncertain" ||
              provider?.outcome === "uncertain",
            executed = Boolean(delivery || waypointMutation || provider),
            rollback = {
              waypoint: delivery
                ? {
                    operation: "revoke_and_delete_channel",
                    channelId: delivery.channelId,
                  }
                : waypointMutation?.rollback,
              provider:
                provider?.rollback ??
                (uncertain
                  ? {
                      operation: "inspect_for_exact_endpoint",
                      endpoint: delivery?.endpoint ?? planned.endpoint,
                    }
                  : undefined),
            };
          return store.finishAutomationProvisioning(
            workspaceId,
            proposalId,
            proposalDigest,
            {
              status: "failed",
              summary,
              delivery,
              executed,
              outcome: uncertain ? "uncertain" : executed ? "partial" : "known",
              rollback,
            },
          );
        }
      } finally {
        if (reserved)
          activeAutomationProvisioningWorkspaces.delete(workspaceId);
      }
    },
  );
  handle("waypoint:webhook-event-delete", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteExternalInboundEvent(
      text(value.workspaceId, "workspace ID", 64),
      text(value.eventId, "event ID", 128),
    );
    return { ok: true };
  });
  handle("waypoint:search-text", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    const workspaceId = text(value.workspaceId, "workspace ID", 64);
    return store.searchText(workspaceId, text(value.query, "query", 500));
  });
  handle("waypoint:search-semantic", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64);
    const embedded = await embeddings.embed([
      text(value.query, "query", 2_000),
    ]);
    const provenance = {
      provider: embeddings.provider,
      providerVersion: embeddings.providerVersion,
      model: embeddings.model,
      modelDigest: embedded.modelDigest,
      chunkingDigest: activeChunkingProvenance,
    };
    const ordinary = store.semanticSearch(
        workspaceId,
        embedded.vectors[0],
        provenance,
      ),
      documents = store.semanticSearch(workspaceId, embedded.vectors[0], {
        ...provenance,
        chunkingDigest: documentChunkingDigest,
      });
    return [...ordinary, ...documents]
      .sort((left, right) => right.score - left.score)
      .filter(
        (item, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.objectId === item.objectId &&
              candidate.revisionId === item.revisionId,
          ) === index,
      )
      .slice(0, 20);
  });
  handle("waypoint:index-document", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      objectId = text(value.objectId, "document ID", 64);
    const document = store
      .listDocuments(workspaceId)
      .find((candidate) => candidate.id === objectId);
    if (!document) throw new Error("Document not found in workspace");
    const embedded = await embeddings.embed([
      `${document.title}\n\n${document.body}`,
    ]);
    store.indexEmbedding(
      workspaceId,
      { objectId, objectKind: "document", revisionId: document.revisionId },
      embedded.vectors[0],
      {
        provider: embeddings.provider,
        providerVersion: embeddings.providerVersion,
        model: embeddings.model,
        modelDigest: embedded.modelDigest,
        chunkingDigest: activeChunkingProvenance,
      },
    );
    return {
      ok: true,
      model: embeddings.model,
      modelDigest: embedded.modelDigest,
    };
  });
  handle("waypoint:delete-document", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteObject(
      text(value.workspaceId, "workspace ID", 64),
      "document",
      text(value.objectId, "document ID", 64),
    );
    return { ok: true };
  });
  handle("waypoint:delete-object", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      kind = text(value.kind, "object kind", 20),
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      objectId = text(value.objectId, "object ID", 64);
    if (!["document", "chat", "memory"].includes(kind))
      throw new Error("Invalid deletable object kind");
    const lifecycleKey = chatLifecycleKey(workspaceId, objectId);
    if (kind === "chat") {
      if (deletingChats.has(lifecycleKey))
        throw new Error("This chat is already being deleted");
      deletingChats.add(lifecycleKey);
      const active = activeAutoTitles.get(objectId);
      if (active?.workspaceId === workspaceId) active.cancel();
    }
    try {
      if (kind === "chat") await cancelHostedChatRuns(workspaceId, objectId);
      await deleteWithExecutionCancellation(
        store,
        [codexWorkbench, claudeWorkbench, grokWorkbench, workbench],
        workspaceId,
        kind as "document" | "chat" | "memory",
        objectId,
      );
    } finally {
      if (kind === "chat") deletingChats.delete(lifecycleKey);
    }
    return { ok: true };
  });
  handle("waypoint:attach-document", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      objectId = text(value.objectId, "document ID", 64);
    const chosen = await dialog.showOpenDialog({
      title: "Attach text to note",
      properties: ["openFile"],
      filters: [
        { name: "Text and Markdown", extensions: ["txt", "md", "markdown"] },
      ],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
    const sourcePath = chosen.filePaths[0],
      extension = path.extname(sourcePath).toLowerCase();
    const mediaType =
      extension === ".md" || extension === ".markdown"
        ? "text/markdown"
        : "text/plain";
    return {
      canceled: false,
      attachmentId: store.addAttachment(
        workspaceId,
        objectId,
        path.basename(sourcePath),
        mediaType,
        sourcePath,
      ),
    };
  });
  handle("waypoint:select-chat-attachments", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64);
    const chosen = await dialog.showOpenDialog({
      title: "Attach files to chat",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Chat attachments",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
            "pdf",
            "docx",
            "txt",
            "md",
            "markdown",
          ],
        },
      ],
    });
    if (chosen.canceled)
      return {
        canceled: true,
        attachments: store.listChatAttachments(workspaceId, chatId),
      };
    const validated = chosen.filePaths.map((sourcePath) => {
        const mediaType =
          ATTACHMENT_MEDIA_BY_EXTENSION[path.extname(sourcePath).toLowerCase()];
        if (!mediaType) throw new Error("Unsupported chat attachment type");
        readAndValidateAttachment(
          sourcePath,
          path.basename(sourcePath),
          mediaType,
        );
        return { sourcePath, mediaType };
      }),
      added: string[] = [];
    try {
      for (const item of validated)
        added.push(
          store.addAttachment(
            workspaceId,
            chatId,
            path.basename(item.sourcePath),
            item.mediaType,
            item.sourcePath,
          ),
        );
    } catch (error) {
      for (const attachmentId of added)
        try {
          store.deleteAttachment(workspaceId, attachmentId);
        } catch {
          /* Best-effort rollback preserves the original picker error. */
        }
      throw error;
    }
    return {
      canceled: false,
      attachments: store.listChatAttachments(workspaceId, chatId),
    };
  });
  handle("waypoint:list-chat-attachments", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.listChatAttachments(
      text(value.workspaceId, "workspace ID", 64),
      text(value.chatId, "chat ID", 64),
    );
  });
  handle("waypoint:add-pasted-chat-image", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64),
      name = text(value.name, "attachment name", 240),
      mediaType = text(value.mediaType, "attachment media type", 40),
      bytes = value.bytes;
    if (!(bytes instanceof Uint8Array))
      throw new Error("Pasted image bytes are invalid");
    imageDimensions(mediaType, bytes);
    const decoded = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (decoded.isEmpty())
      throw new Error("Pasted image is corrupt or cannot be decoded safely");
    const id = store.addAttachmentBytes(
        workspaceId,
        chatId,
        name,
        mediaType,
        bytes,
      ),
      attachment = store
        .listChatAttachments(workspaceId, chatId)
        .find((item) => item.id === id);
    if (!attachment) throw new Error("Pasted image could not be queued");
    return { attachment };
  });
  handle("waypoint:attachment-image-preview", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      attachmentId = text(value.attachmentId, "attachment ID", 64),
      variant = text(value.variant, "preview variant", 12);
    if (variant !== "thumbnail" && variant !== "viewer")
      throw new Error("Invalid preview variant");
    const { metadata, bytes } = store.readAttachment(workspaceId, attachmentId);
    if (!metadata.mediaType.startsWith("image/"))
      throw new Error("Only image attachments can be previewed");
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty())
      throw new Error(
        "Image preview is unavailable because the file is corrupt",
      );
    const source = image.getSize(),
      maxEdge = variant === "thumbnail" ? 360 : 2400,
      scale = Math.min(1, maxEdge / Math.max(source.width, source.height)),
      resized =
        scale < 1
          ? image.resize({
              width: Math.max(1, Math.round(source.width * scale)),
              height: Math.max(1, Math.round(source.height * scale)),
              quality: "good",
            })
          : image,
      size = resized.getSize(),
      png = resized.toPNG();
    if (!png.byteLength) throw new Error("Image preview could not be rendered");
    return {
      mediaType: "image/png",
      dataBase64: png.toString("base64"),
      width: size.width,
      height: size.height,
    };
  });
  handle("waypoint:delete-attachment", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteAttachment(
      text(value.workspaceId, "workspace ID", 64),
      text(value.attachmentId, "attachment ID", 64),
    );
    return { ok: true };
  });
  handle("waypoint:graph", (_event, input: unknown) =>
    store.graph(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:activity", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      families = Array.isArray(value.families)
        ? (value.families.map((item) =>
            text(item, "activity family", 20),
          ) as import("./core/types.js").ActivityFamily[])
        : undefined,
      query =
        value.query === undefined
          ? undefined
          : text(value.query, "activity query", 100);
    return store.listActivity(text(value.workspaceId, "workspace ID", 64), {
      families,
      query,
      limit: value.limit === undefined ? undefined : Number(value.limit),
    });
  });
  handle("waypoint:create-meeting", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    if (value.consentAcknowledged !== true)
      throw new Error(
        "Recording consent must be acknowledged for this session",
      );
    return {
      meetingId: store.createMeeting(
        text(value.workspaceId, "workspace ID", 64),
        text(value.title, "meeting title", 300),
      ),
    };
  });
  handle("waypoint:finalize-meeting", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      meetingId = text(value.meetingId, "meeting ID", 64),
      mediaType = text(value.mediaType, "meeting media type", 40);
    if (!(value.audio instanceof Uint8Array))
      throw new Error("Meeting audio payload is invalid");
    const bytes = Buffer.from(value.audio),
      disk = statfsSync(app.getPath("userData")),
      free = Number(disk.bavail) * Number(disk.bsize);
    if (free < bytes.length + 256 * 1024 * 1024) {
      store.failMeeting(workspaceId, meetingId, "disk_pressure");
      throw new Error("Not enough free space to save this recording");
    }
    try {
      store.finalizeMeetingAudio(workspaceId, meetingId, mediaType, bytes);
    } catch (error) {
      store.failMeeting(workspaceId, meetingId, "capture_failed");
      throw error;
    }
    return { ok: true };
  });
  handle("waypoint:fail-meeting", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      code = text(value.failureCode, "meeting failure code", 40);
    if (
      ![
        "permission_denied",
        "device_lost",
        "interrupted",
        "disk_pressure",
        "capture_failed",
        "size_limit",
      ].includes(code)
    )
      throw new Error("Meeting failure code is invalid");
    store.failMeeting(
      text(value.workspaceId, "workspace ID", 64),
      text(value.meetingId, "meeting ID", 64),
      code as
        | "permission_denied"
        | "device_lost"
        | "interrupted"
        | "disk_pressure"
        | "capture_failed"
        | "size_limit",
    );
    return { ok: true };
  });
  handle("waypoint:list-meetings", (_event, input: unknown) =>
    store.listMeetings(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:update-meeting-transcript", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.updateMeetingTranscript(
      text(value.workspaceId, "workspace ID", 64),
      text(value.meetingId, "meeting ID", 64),
      text(value.transcript, "meeting transcript", 500_000),
      value.reviewed === true,
    );
    return { ok: true };
  });
  handle("waypoint:save-meeting-memory", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return {
      memoryId: store.saveMeetingTranscriptToMemory(
        text(value.workspaceId, "workspace ID", 64),
        text(value.meetingId, "meeting ID", 64),
      ),
    };
  });
  handle("waypoint:delete-meeting", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    const workspaceId = text(value.workspaceId, "workspace ID", 64),
      meetingId = text(value.meetingId, "meeting ID", 64);
    for (const [id, run] of meetingTranscriptionRuns)
      if (run.workspaceId === workspaceId && run.meetingId === meetingId)
        cancelMeetingRun(id);
    let audio: ReturnType<WorkspaceStore["meetingAudio"]> | undefined;
    try {
      audio = store.meetingAudio(workspaceId, meetingId);
    } catch {
      // Failed meetings and already-missing files have no playback artifact.
    }
    store.deleteMeeting(workspaceId, meetingId);
    if (audio) {
      const paths = new Set([
        audio.path,
        meetingPlaybackCachePath(meetingPlaybackCacheRoot, audio.sha256),
      ]);
      for (const [token, grant] of meetingPlaybackGrants)
        if (paths.has(grant.path)) meetingPlaybackGrants.delete(token);
      removeSeekableMeetingPlayback(meetingPlaybackCacheRoot, audio.sha256);
    }
    return { ok: true };
  });
  handle("waypoint:read-meeting-audio", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      audio = store.meetingAudio(
        text(value.workspaceId, "workspace ID", 64),
        text(value.meetingId, "meeting ID", 64),
      );
    return { mediaType: audio.mediaType, audio: readFileSync(audio.path) };
  });
  handle("waypoint:meeting-playback-url", async (event, input: unknown) => {
    const value = input as Record<string, unknown>,
      audio = store.meetingAudio(
        text(value.workspaceId, "workspace ID", 64),
        text(value.meetingId, "meeting ID", 64),
      ),
      playbackPath = await meetingPlaybackPath(audio),
      bytes = statSync(playbackPath).size,
      token = randomBytes(32).toString("hex");
    for (const [key, grant] of meetingPlaybackGrants)
      if (grant.expiresAt < Date.now()) meetingPlaybackGrants.delete(key);
    meetingPlaybackGrants.set(token, {
      path: playbackPath,
      mediaType: audio.mediaType,
      bytes,
      expiresAt: Date.now() + 2 * 60 * 60_000,
    });
    event.sender.once("destroyed", () => meetingPlaybackGrants.delete(token));
    return {
      url: `waypoint-media://${token}/recording`,
      mediaType: audio.mediaType,
    };
  });
  handle("waypoint:export-meeting-audio", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      audio = store.meetingAudio(
        text(value.workspaceId, "workspace ID", 64),
        text(value.meetingId, "meeting ID", 64),
      ),
      extension =
        audio.mediaType === "audio/webm"
          ? "webm"
          : audio.mediaType === "audio/mp4"
            ? "m4a"
            : audio.mediaType === "audio/ogg"
              ? "ogg"
              : "wav",
      chosen = await dialog.showSaveDialog({
        title: "Export local meeting audio",
        defaultPath: `${audio.title.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 80)}.${extension}`,
      });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    writeFileSync(chosen.filePath, readFileSync(audio.path), {
      flag: "wx",
      mode: 0o600,
    });
    return { canceled: false };
  });
  handle("waypoint:meeting-transcription-capability", async () => {
    const [transcriptionReady, decoder] = await Promise.all([
        meetingTranscription.probe(),
        (meetingMediaDecoderProbe ??= probeMeetingMediaDecoder()),
      ]),
      available = transcriptionReady && decoder.available;
    return {
      available,
      provider: "Fast Local Whisper tiny.en",
      speakerDiarization: false,
      reason: available
        ? "Local English transcription is ready for recordings up to two hours using the packaged Whisper model and installed FFmpeg decoder. Output is an unreviewed draft; speaker identity and diarization are not inferred. Audio never leaves this device."
        : transcriptionReady
          ? decoder.reason
          : "Packaged local transcription failed its readiness probe. Manual transcript review remains available; no cloud fallback will be used.",
    };
  });
  handle("waypoint:meeting-transcription-start", (event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      meetingId = text(value.meetingId, "meeting ID", 64),
      meeting = store
        .listMeetings(workspaceId)
        .find((item) => item.id === meetingId);
    if (!meeting || meeting.status !== "ready")
      throw new Error("Completed meeting not found");
    store.meetingAudio(workspaceId, meetingId);
    if (meetingTranscriptionRuns.size)
      throw new Error("A local meeting transcription is already running");
    const runId = randomUUID(),
      controller = new AbortController(),
      deadline = Date.now() + 60 * 60_000,
      stopTimer = setInterval(() => {
        if (
          Date.now() > deadline ||
          store.toolGatewaySettings(workspaceId).stopped
        )
          cancelMeetingRun(runId);
      }, 100);
    stopTimer.unref();
    event.sender.once("destroyed", () => cancelMeetingRun(runId));
    meetingTranscriptionRuns.set(runId, {
      workspaceId,
      meetingId,
      nextIndex: 0,
      parts: [],
      characters: 0,
      controller,
      inFlight: false,
      baseline: JSON.stringify([meeting.transcript, meeting.transcriptStatus]),
      stopTimer,
    });
    return { runId };
  });
  handle(
    "waypoint:meeting-transcription-recording",
    async (event, input: unknown) => {
      const value = input as Record<string, unknown>,
        runId = text(value.runId, "transcription run ID", 64),
        workspaceId = text(value.workspaceId, "workspace ID", 64),
        meetingId = text(value.meetingId, "meeting ID", 64),
        run = meetingTranscriptionRuns.get(runId);
      if (
        !run ||
        run.workspaceId !== workspaceId ||
        run.meetingId !== meetingId ||
        run.inFlight
      )
        throw new Error("Meeting transcription run is invalid");
      const decoder = await (meetingMediaDecoderProbe ??=
        probeMeetingMediaDecoder());
      if (!decoder.available || !decoder.command) {
        cancelMeetingRun(runId);
        throw new Error(decoder.reason);
      }
      const audio = store.meetingAudio(workspaceId, meetingId);
      run.inFlight = true;
      try {
        await transcribeMeetingFile({
          audioPath: audio.path,
          decoderCommand: decoder.command,
          temporaryRoot: path.join(
            app.getPath("userData"),
            "meeting-transcription-tmp",
          ),
          signal: run.controller.signal,
          transcribe: async (bytes, signal) => {
            const result = await meetingTranscription.transcribe(bytes, signal),
              part = result.text.trim().slice(0, 100_000);
            if (!part) throw new Error("Meeting transcript segment was empty");
            if (run.characters + part.length > 500_000)
              throw new Error("Meeting transcript exceeds bounds");
            run.parts.push(part);
            run.characters += part.length;
            run.nextIndex++;
            return { text: part };
          },
          onProgress: (progress) =>
            event.sender.send("waypoint:meeting-transcription-progress", {
              workspaceId,
              meetingId,
              runId,
              ...progress,
            }),
        });
        const meeting = store
          .listMeetings(workspaceId)
          .find((item) => item.id === meetingId);
        if (
          !meetingTranscriptionRuns.has(runId) ||
          !meeting ||
          meeting.status !== "ready" ||
          store.toolGatewaySettings(workspaceId).stopped ||
          run.baseline !==
            JSON.stringify([meeting.transcript, meeting.transcriptStatus]) ||
          !run.parts.length
        )
          throw new Error(
            "Meeting transcription could not be committed because its source or policy changed",
          );
        clearInterval(run.stopTimer);
        meetingTranscriptionRuns.delete(runId);
        const transcript = run.parts.join("\n\n");
        run.parts.length = 0;
        store.updateMeetingTranscript(
          workspaceId,
          meetingId,
          transcript,
          false,
        );
        return { transcript, provider: "Fast Local Whisper tiny.en" };
      } catch (error) {
        cancelMeetingRun(runId);
        throw error;
      } finally {
        const current = meetingTranscriptionRuns.get(runId);
        if (current) current.inFlight = false;
      }
    },
  );
  handle(
    "waypoint:meeting-transcription-segment",
    async (_event, input: unknown) => {
      const value = input as Record<string, unknown>,
        runId = text(value.runId, "transcription run ID", 64),
        workspaceId = text(value.workspaceId, "workspace ID", 64),
        meetingId = text(value.meetingId, "meeting ID", 64),
        run = meetingTranscriptionRuns.get(runId),
        index = Number(value.index);
      if (
        !run ||
        run.workspaceId !== workspaceId ||
        run.meetingId !== meetingId ||
        run.inFlight ||
        !Number.isSafeInteger(index) ||
        index !== run.nextIndex ||
        index >= 5 ||
        !(value.audio instanceof Uint8Array) ||
        value.audio.byteLength > 12 * 1024 * 1024
      )
        throw new Error("Meeting transcription segment is invalid");
      if (store.toolGatewaySettings(run.workspaceId).stopped) {
        cancelMeetingRun(runId);
        throw new Error("Global stop is active");
      }
      run.inFlight = true;
      try {
        const result = await meetingTranscription.transcribe(
            value.audio,
            run.controller.signal,
          ),
          part = result.text.slice(0, 100_000);
        if (
          run.controller.signal.aborted ||
          !meetingTranscriptionRuns.has(runId)
        )
          throw new Error("Meeting transcription canceled");
        if (run.characters + part.length > 500_000)
          throw new Error("Meeting transcript exceeds bounds");
        run.parts.push(part);
        run.characters += part.length;
        run.nextIndex++;
        return { completedSegments: run.nextIndex };
      } finally {
        run.inFlight = false;
        value.audio.fill(0);
      }
    },
  );
  handle("waypoint:meeting-transcription-finish", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      runId = text(value.runId, "transcription run ID", 64),
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      meetingId = text(value.meetingId, "meeting ID", 64),
      run = meetingTranscriptionRuns.get(runId),
      meeting = store
        .listMeetings(workspaceId)
        .find((item) => item.id === meetingId);
    if (
      !run ||
      run.workspaceId !== workspaceId ||
      run.meetingId !== meetingId ||
      run.inFlight ||
      !run.parts.length ||
      !meeting ||
      meeting.status !== "ready" ||
      store.toolGatewaySettings(workspaceId).stopped ||
      run.baseline !==
        JSON.stringify([meeting.transcript, meeting.transcriptStatus])
    ) {
      cancelMeetingRun(runId);
      throw new Error(
        "Meeting transcription could not be committed because its source or policy changed",
      );
    }
    clearInterval(run.stopTimer);
    meetingTranscriptionRuns.delete(runId);
    const transcript = run.parts.join("\n\n");
    run.parts.length = 0;
    store.updateMeetingTranscript(
      run.workspaceId,
      run.meetingId,
      transcript,
      false,
    );
    return { transcript, provider: "Fast Local Whisper tiny.en" };
  });
  handle("waypoint:meeting-transcription-cancel", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      runId = text(value.runId, "transcription run ID", 64),
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      meetingId = text(value.meetingId, "meeting ID", 64),
      run = meetingTranscriptionRuns.get(runId);
    return {
      canceled: Boolean(
        run &&
        run.workspaceId === workspaceId &&
        run.meetingId === meetingId &&
        cancelMeetingRun(runId),
      ),
    };
  });
  handle("waypoint:create-local-webhook-fixture", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      payload = value.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("Local fixture payload is invalid");
    return {
      eventId: store.createLocalWebhookFixture(
        text(value.workspaceId, "workspace ID", 64),
        text(value.eventType, "event type", 80),
        text(value.idempotencyKey, "idempotency key", 128),
        payload as Record<string, string | number | boolean | null>,
      ),
    };
  });
  handle("waypoint:list-local-trigger-lab", (_event, input: unknown) =>
    store.listLocalTriggerLab(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:approve-local-trigger-rule", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.approveLocalTriggerRule(
      text(value.workspaceId, "workspace ID", 64),
      text(value.ruleId, "rule ID", 64),
    );
    return { ok: true };
  });
  handle("waypoint:dry-run-local-trigger-rule", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.dryRunLocalTriggerRule(
      text(value.workspaceId, "workspace ID", 64),
      text(value.ruleId, "rule ID", 64),
      value.simulateFailure === true,
    );
  });
  handle("waypoint:set-local-trigger-kill", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.setLocalTriggerKillSwitch(
      text(value.workspaceId, "workspace ID", 64),
      value.enabled === true,
    );
    return { ok: true };
  });
  handle("waypoint:delete-local-trigger-event", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteLocalTriggerEvent(
      text(value.workspaceId, "workspace ID", 64),
      text(value.eventId, "event ID", 64),
    );
    return { ok: true };
  });
  handle("waypoint:create-fixture-playbook", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      hour = Number(value.hour),
      minute = Number(value.minute);
    if (!Number.isInteger(hour) || !Number.isInteger(minute))
      throw new Error("Playbook time is invalid");
    return {
      playbookId: store.createFixturePlaybook(
        text(value.workspaceId, "workspace ID", 64),
        text(value.title, "playbook title", 200),
        text(value.timezone, "timezone", 100),
        hour,
        minute,
      ),
    };
  });
  handle("waypoint:list-fixture-playbooks", (_event, input: unknown) =>
    store.listFixturePlaybooks(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:dry-run-fixture-playbook", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.dryRunFixturePlaybook(
      text(value.workspaceId, "workspace ID", 64),
      text(value.playbookId, "playbook ID", 64),
    );
  });
  handle("waypoint:run-fixture-playbook", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.runFixturePlaybook(
      text(value.workspaceId, "workspace ID", 64),
      text(value.playbookId, "playbook ID", 64),
      text(value.dryRunDigest, "dry-run digest", 128),
      value.simulateFailure === true,
    );
  });
  handle("waypoint:kill-fixture-playbook", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.killFixturePlaybook(
      text(value.workspaceId, "workspace ID", 64),
      text(value.playbookId, "playbook ID", 64),
    );
    return { ok: true };
  });
  handle("waypoint:delete-fixture-playbook", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.deleteFixturePlaybook(
      text(value.workspaceId, "workspace ID", 64),
      text(value.playbookId, "playbook ID", 64),
    );
    return { ok: true };
  });
  handle("waypoint:list-chats", (_event, input: unknown) =>
    store.listChats(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:ensure-chat-title", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64);
    if (!autoTitleMayStart(store.toolGatewaySettings(workspaceId).stopped))
      return { started: false };
    const candidate = store.autoTitleCandidate(workspaceId, chatId);
    if (!candidate) return { started: false };
    startAutomaticChatTitle(workspaceId, chatId, candidate.user);
    return { started: true };
  });
  handle("waypoint:rename-chat", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64);
    store.renameChat(workspaceId, chatId, text(value.title, "chat title", 72));
    const active = activeAutoTitles.get(chatId);
    if (active && active.workspaceId === workspaceId) active.cancel();
    return { ok: true };
  });
  handle("waypoint:cli-capabilities", async () =>
    Promise.all([detectCli("codex"), detectCli("claude"), detectCli("grok")]),
  );
  handle("waypoint:cli-model-catalog", async () =>
    installedCliModelCatalog(
      await Promise.all([
        detectCli("codex"),
        detectCli("claude"),
        detectCli("grok"),
      ]),
      undefined,
      providerModelCatalogAbort.signal,
    ),
  );
  handle("waypoint:chat-model-preferences", (_event, input: unknown) =>
    store.chatModelPreferences(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:chat-model-preference", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    if (!["codex", "claude", "grok"].includes(String(value.provider)))
      throw new Error("Chat provider is invalid");
    return store.setChatModelPreference(
      text(value.workspaceId, "workspace ID", 64),
      value.provider as "codex" | "claude" | "grok",
      String(value.model ?? ""),
    );
  });
  handle("waypoint:chat-thinking-preferences", (_event, input: unknown) =>
    store.chatThinkingPreferences(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:chat-thinking-preference", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      lane = String(value.lane);
    if (
      ![
        "codex",
        "claude",
        "grok",
        "openrouterStrategic",
        "openrouterEveryday",
        "openrouterAttachment",
      ].includes(lane)
    )
      throw new Error("Chat thinking lane is invalid");
    return store.setChatThinkingPreference(
      text(value.workspaceId, "workspace ID", 64),
      lane as import("../src/model-thinking.js").ThinkingLane,
      String(value.effort ?? ""),
    );
  });
  handle("waypoint:propose-chat-route", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64),
      preferred = text(value.preferred, "preferred provider", 20);
    if (!["codex", "claude", "grok"].includes(preferred))
      throw new Error("Unsupported preferred provider");
    const profileId = text(value.securityProfileId, "security profile ID", 64);
    if (
      !store
        .listSecurityProfiles(workspaceId)
        .some((item) => item.id === profileId)
    )
      throw new Error("Security profile not found");
    const ids = Array.isArray(value.attachmentIds)
        ? value.attachmentIds.map((item) => text(item, "attachment ID", 64))
        : [],
      available = new Map(
        store
          .listChatAttachments(workspaceId, chatId)
          .map((item) => [item.id, item]),
      );
    if (ids.some((id) => !available.has(id)))
      throw new Error("Attachment not found in chat");
    return proposeRoute({
      capabilities: await Promise.all([
        detectCli("codex"),
        detectCli("claude"),
        detectCli("grok"),
      ]),
      preferred: preferred as "codex" | "claude" | "grok",
      allowFallback: value.allowFallback === true,
      securityProfileId: profileId,
      attachments: ids.map((id) => ({
        id,
        mediaType: available.get(id)!.mediaType,
        bytes: available.get(id)!.bytes,
      })),
    });
  });
  handle("waypoint:list-security-profiles", (_event, input: unknown) =>
    store.listSecurityProfiles(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:list-provider-sessions", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.listProviderSessions(
      text(value.workspaceId, "workspace ID", 64),
      value.chatId ? text(value.chatId, "chat ID", 64) : undefined,
    );
  });
  handle("waypoint:reset-provider-session", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      provider = text(value.provider, "provider", 20);
    if (!["codex", "claude", "grok"].includes(provider))
      throw new Error("Provider is invalid");
    return {
      reset: store.resetProviderSession(
        text(value.workspaceId, "workspace ID", 64),
        text(value.chatId, "chat ID", 64),
        provider as "codex" | "claude" | "grok",
      ),
    };
  });
  handle("waypoint:list-provider-requests", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.listProviderRequests(
      text(value.workspaceId, "workspace ID", 64),
      value.chatId ? text(value.chatId, "chat ID", 64) : undefined,
    );
  });
  handle(
    "waypoint:resolve-provider-request",
    async (_event, input: unknown) => {
      const value = input as Record<string, unknown>,
        workspaceId = text(value.workspaceId, "workspace ID", 64),
        id = text(value.id, "provider request ID", 64),
        status = text(value.status, "provider decision", 30);
      if (
        !["accepted", "accepted_session", "declined", "canceled"].includes(
          status,
        )
      )
        throw new Error("Provider decision is invalid");
      const decision =
          value.decision &&
          typeof value.decision === "object" &&
          !Array.isArray(value.decision)
            ? (value.decision as Record<string, unknown>)
            : {},
        request = store.providerRequest(workspaceId, id);
      if (!request) throw new Error("Provider request was not found");
      const resolver = providerDecisionResolvers.get(id);
      if (!resolver)
        throw new Error(
          "This provider request is no longer attached to a live run",
        );
      const resolved = store.resolveProviderRequest(
        workspaceId,
        id,
        status as "accepted" | "accepted_session" | "declined" | "canceled",
        auditableProviderDecision(request, decision),
      );
      providerDecisionResolvers.delete(id);
      await resolver({
        status: status as
          "accepted" | "accepted_session" | "declined" | "canceled",
        decision,
      });
      return resolved;
    },
  );
  handle("waypoint:list-executions", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    const workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = value.chatId ? text(value.chatId, "chat ID", 64) : undefined;
    return [
      ...store.listExecutions(workspaceId, chatId),
      ...store.listHostedRuns(workspaceId, chatId),
    ];
  });
  handle("waypoint:run-chat", async (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      chatId = text(value.chatId, "chat ID", 64);
    assertChatMayStart(workspaceId, chatId);
    const cli = text(value.cli, "CLI", 20);
    if (!["codex", "claude", "grok"].includes(cli))
      throw new Error("Unsupported CLI");
    let prompt = text(value.prompt, "prompt");
    const userPrompt = prompt;
    const profileId = text(value.securityProfileId, "security profile ID", 64),
      parentExecutionId = value.parentExecutionId
        ? text(value.parentExecutionId, "parent execution ID", 64)
        : undefined;
    const sourceMessageId = text(
        value.sourceMessageId,
        "source message ID",
        64,
      ),
      attachmentIds = Array.isArray(value.attachmentIds)
        ? value.attachmentIds.map((item) => text(item, "attachment ID", 64))
        : [];
    if (new Set(attachmentIds).size !== attachmentIds.length)
      throw new Error("Invalid chat attachment selection");
    const workspace = store
      .listWorkspaces()
      .find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const profile = store
      .listSecurityProfiles(workspaceId)
      .find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error("Security profile not found");
    let childTask: ChildTaskManifest | undefined;
    if (parentExecutionId) {
      childTask = createChildTask({
        type: text(value.taskType, "child task type", 20),
        instruction: prompt,
        parentExecutionId,
        provider: cli as "codex" | "claude" | "grok",
        securityProfileId: profileId,
        profileMaxDurationMs: profile.maxDurationMs,
      });
      const parent = store
        .listExecutions(workspaceId, chatId)
        .find((item) => item.id === parentExecutionId);
      if (!parent) throw new Error("Parent execution not found");
      assertChildAgainstParent(childTask, parent);
      if (attachmentIds.length)
        throw new Error("Child tasks cannot receive attachments");
      prompt = childContext(parent, childTask);
    }
    const chatAttachmentIds = new Set(
      store
        .listChatAttachments(workspaceId, chatId)
        .map((attachment) => attachment.id),
    );
    if (attachmentIds.some((id) => !chatAttachmentIds.has(id)))
      throw new Error("Attachment not found in chat");
    const attachmentMetadata = new Map(
        store
          .listChatAttachments(workspaceId, chatId)
          .map((item) => [item.id, item]),
      ),
      route = proposeRoute({
        capabilities: await Promise.all([
          detectCli("codex"),
          detectCli("claude"),
          detectCli("grok"),
        ]),
        preferred: cli as "codex" | "claude" | "grok",
        allowFallback: false,
        securityProfileId: profileId,
        attachments: attachmentIds.map((id) => ({
          id,
          mediaType: attachmentMetadata.get(id)!.mediaType,
          bytes: attachmentMetadata.get(id)!.bytes,
        })),
      });
    assertRoute(route, cli as "codex" | "claude" | "grok", profileId);
    const canonicalExecutionRoot =
      store.assertWorkspaceExecutionRoot(workspaceId);
    const preparedAttachments = await prepareChatAttachments(
      workspaceId,
      chatId,
      attachmentIds,
      false,
      cli === "grok" ? canonicalExecutionRoot : undefined,
    );
    prompt = withChatAttachmentContext(prompt, preparedAttachments.textBlocks);
    prompt = withChatFileAttachmentContext(
      prompt,
      preparedAttachments.fileBlocks,
    );
    const providerAttachmentRoute = route.providers.find(
        (item) => item.provider === cli,
      )!,
      passedToCli = [...providerAttachmentRoute.deliverableAttachmentIds],
      unsupported: Array<{ id: string; reason: string }> =
        providerAttachmentRoute.localOnlyAttachmentIds.map((id) => ({
          id,
          reason: `${cli} does not advertise this attachment media type through its native protocol`,
        }));
    const interactiveSlashSkillMatch = !parentExecutionId
        ? userPrompt.trimStart().match(/^\/([a-z0-9][a-z0-9._-]*)(?:\s|$)/i)
        : null,
      interactiveSlashSkillIdentifier = interactiveSlashSkillMatch?.[1],
      isInteractiveSlashSkill = Boolean(interactiveSlashSkillIdentifier);
    const helpSelection =
      parentExecutionId || isInteractiveSlashSkill
        ? undefined
        : withProductHelp(prompt, userPrompt, productHelpLibrary);
    if (helpSelection) prompt = helpSelection.prompt;
    const selectedModel = value.model
        ? text(value.model, "model", 120)
        : undefined,
      rawReasoningEffort = value.reasoningEffort
        ? text(value.reasoningEffort, "thinking level", 20)
        : undefined;
    if (rawReasoningEffort && !isThinkingEffort(rawReasoningEffort))
      throw new Error(
        "The selected thinking level is not supported by this provider model",
      );
    const reasoningEffort = rawReasoningEffort as ThinkingEffort | undefined;
    if (
      reasoningEffort &&
      !localProviderAllowsThinking(
        cli as "codex" | "claude" | "grok",
        selectedModel,
        reasoningEffort,
      )
    )
      throw new Error(
        "The selected thinking level is not supported by this provider model",
      );
    if (!isInteractiveSlashSkill) {
      prompt = withCurrentDateTime(prompt);
      if (!parentExecutionId)
        prompt = withAutomationProposalTool({
          prompt,
          chatId,
          provider: cli as "codex" | "claude" | "grok",
          model: selectedModel,
          securityProfileId: profileId,
        });
    }
    if (cli === "codex" && !parentExecutionId) {
      const activeKey = `${workspaceId}:${chatId}`,
        active = activeCodexChats.get(activeKey);
      if (active) {
        if (
          !codexTurnCanBeSteered(active, {
            profileId,
            model: selectedModel,
            reasoningEffort,
          })
        ) {
          preparedAttachments.cleanup();
          throw new Error(
            "Finish or cancel the active Codex turn before changing its model, thinking level, or authority profile",
          );
        }
        if (attachmentIds.length) {
          preparedAttachments.cleanup();
          throw new Error(
            "Image and document attachments cannot be added while steering an active Codex turn",
          );
        }
        if (await codexWorkbench.steer(active.runId, prompt)) {
          preparedAttachments.cleanup();
          return {
            runId: active.runId,
            status: "running",
            steered: true,
            attachmentDelivery: { passedToCli: [], unsupported: [] },
          };
        }
        activeCodexChats.delete(activeKey);
      }
    }
    let runId: string;
    try {
      const budget = createExecutionBudget({
        kind: parentExecutionId ? "child" : "root",
        profile,
        prompt,
        attachmentCount: attachmentIds.length,
      });
      if (parentExecutionId)
        validateOneChildDelegation(
          store.listExecutions(workspaceId, chatId),
          parentExecutionId,
          profileId,
        );
      assertChatMayStart(workspaceId, chatId);
      runId = store.createExecution({
        workspaceId,
        chatId,
        sourceMessageId,
        cli: cli as "codex" | "claude" | "grok",
        routedCliVersion: route.providers.find((item) => item.provider === cli)
          ?.version,
        model: selectedModel,
        reasoningEffort: reasoningEffort as ThinkingEffort | undefined,
        securityProfileId: profileId,
        prompt,
        parentExecutionId,
        depth: parentExecutionId ? 1 : 0,
        taskType: childTask?.type,
        budgetReceipt: serializeExecutionBudget(budget),
      });
      if (helpSelection?.sources.length)
        store.appendExecutionEvent(runId, workspaceId, {
          type: "diagnostic",
          name: `Waypoint Help · ${helpSelection.sources.length} source${helpSelection.sources.length === 1 ? "" : "s"}`,
          text: helpSelection.sources
            .map((source) => `${source.title} [${source.sha256.slice(0, 12)}]`)
            .join("; "),
          rawType: `waypoint-help:${helpSelection.helpVersion}`,
        });
      if (preparedAttachments.receipt)
        store.appendExecutionEvent(runId, workspaceId, {
          type: "diagnostic",
          name: `Attachment delivery · ${attachmentIds.length} source${attachmentIds.length === 1 ? "" : "s"}`,
          text: preparedAttachments.receipt,
          rawType: "waypoint-attachments:v1",
        });
      if (reasoningEffort)
        store.appendExecutionEvent(runId, workspaceId, {
          type: "policy",
          name: `Thinking · ${reasoningEffort}`,
          rawType: "waypoint-thinking:v1",
        });
    } catch (error) {
      preparedAttachments.cleanup();
      throw error;
    }
    const fallbackEvents: ExecutionEvent[] = [];
    let nativeAutomationPrepared = false,
      nativeAutomationSummary: string | undefined,
      nativeAutomationResult:
        | { proposalId: string; status: string; summary?: string }
        | undefined,
      nativeAutomationInFlight:
        | Promise<{ proposalId: string; status: string; summary?: string }>
        | undefined;
    const onAutomationProposal = !parentExecutionId
      ? async (definition: Record<string, unknown>) => {
          if (nativeAutomationResult) return nativeAutomationResult;
          if (nativeAutomationInFlight) return nativeAutomationInFlight;
          nativeAutomationInFlight = (async () => {
            const validated = validateAutomationProposal(definition),
              proposal = await prepareAutomationProposal(
                workspaceId,
                chatId,
                validated,
                validated.action.kind === "ai_skill"
                  ? {
                      provider: cli as "codex" | "claude" | "grok",
                      identifier: validated.action.skillIdentifier,
                    }
                  : undefined,
              );
            nativeAutomationPrepared = true;
            nativeAutomationSummary = automationProposalPreparedSummary(
              proposal.definition,
            );
            nativeAutomationResult = {
              proposalId: proposal.id,
              status: proposal.status,
              summary: nativeAutomationSummary,
            };
            return nativeAutomationResult;
          })();
          try {
            return await nativeAutomationInFlight;
          } finally {
            nativeAutomationInFlight = undefined;
          }
        }
      : undefined;
    try {
      const running = await startDurableChild({
        workspaceId,
        runId,
        detect: async () => {
          const capability = await detectCli(
            cli as "codex" | "claude" | "grok",
          );
          if (capability.available && capability.compatible === false)
            throw new Error(capability.compatibilityError);
          const routedVersion = route.providers.find(
            (item) => item.provider === cli,
          )?.version;
          if (capability.version !== routedVersion)
            throw new Error(
              "CLI version changed after route approval; review the route and retry",
            );
          return capability;
        },
        executionExists: (owner, id) => store.executionIsQueued(owner, id),
        spawn: (capability) => {
          const model = selectedModel,
            sharedRequest = {
              prompt,
              workspaceRoot: canonicalExecutionRoot,
              profile,
              model,
              reasoningEffort: reasoningEffort as ThinkingEffort | undefined,
              executable: capability.executable,
              version: capability.version,
              parentRunId: parentExecutionId,
              depth: parentExecutionId ? 1 : 0,
              images: cli === "grok" ? [] : preparedAttachments.images,
              beforeSpawn: () => {
                const currentExecutionRoot =
                  store.assertWorkspaceExecutionRoot(workspaceId);
                assertPreparedChatAttachmentsCurrent(
                  workspaceId,
                  chatId,
                  preparedAttachments.sources,
                );
                assertPreparedProviderFilesCurrent(
                  preparedAttachments.fileBlocks,
                  currentExecutionRoot,
                );
              },
            },
            onEvent = (event: ExecutionEvent) => {
              fallbackEvents.push(event);
              try {
                store.appendExecutionEvent(runId, workspaceId, event);
              } catch {
                /* The in-memory stream preserves terminal output; deletion revokes persistence authority. */
              }
            };
          if (cli === "codex") {
            const existing = store.providerSession(
                workspaceId,
                chatId,
                "codex",
              ) as
                | {
                    status: string;
                    executionRoot: string;
                    securityProfileId: string;
                    model?: string;
                    providerSessionId: string;
                  }
                | undefined,
              providerSessionId =
                existing?.status === "active" &&
                existing.executionRoot === profile.roots[0] &&
                existing.securityProfileId === profile.id &&
                (existing.model ?? undefined) === model
                  ? String(existing.providerSessionId)
                  : undefined;
            const conversationPrompt = existing && !providerSessionId
              ? `[Waypoint conversation history bridged into a fresh tool-capable provider session]\n${store
                  .chatMessages(workspaceId, chatId)
                  .filter(
                    (message) =>
                      message.id !== sourceMessageId &&
                      message.role !== "system",
                  )
                  .map((message) => `[${message.role}]\n${message.body}`)
                  .join("\n\n")}\n\n[Current request]\n${sharedRequest.prompt}`
              : sharedRequest.prompt;
            return codexWorkbench.start(
              runId,
              {
                ...sharedRequest,
                prompt: conversationPrompt,
                cli: "codex",
                providerSessionId,
                onAutomationProposal,
                requiredSkillIdentifier: interactiveSlashSkillIdentifier,
                beforeTurn: () => {
                  const currentExecutionRoot =
                    store.assertWorkspaceExecutionRoot(workspaceId);
                  assertPreparedChatAttachmentsCurrent(
                    workspaceId,
                    chatId,
                    preparedAttachments.sources,
                  );
                  assertPreparedProviderFilesCurrent(
                    preparedAttachments.fileBlocks,
                    currentExecutionRoot,
                  );
                },
                onSession: (sessionId) => {
                  store.bindProviderSession({
                    workspaceId,
                    chatId,
                    provider: "codex",
                    providerSessionId: sessionId,
                    executionRoot: canonicalExecutionRoot,
                    securityProfileId: profile.id,
                    model,
                  });
                },
                onApproval: (request, signal) =>
                  awaitProviderDecision(
                    {
                      workspaceId,
                      chatId,
                      executionId: runId,
                      provider: "codex",
                      request,
                    },
                    signal,
                  ),
              },
              onEvent,
            );
          }
          if (cli === "grok") {
            const existing = store.providerSession(
                workspaceId,
                chatId,
                "grok",
              ) as
                | {
                    status: string;
                    executionRoot: string;
                    securityProfileId: string;
                    model?: string;
                    providerSessionId: string;
                  }
                | undefined,
              providerSessionId =
                existing?.status === "active" &&
                existing.executionRoot === profile.roots[0] &&
                existing.securityProfileId === profile.id &&
                (existing.model ?? undefined) === model
                  ? String(existing.providerSessionId)
                  : undefined;
            const conversationPrompt = existing && !providerSessionId
              ? `[Waypoint conversation history bridged into a fresh tool-capable provider session]\n${store
                  .chatMessages(workspaceId, chatId)
                  .filter(
                    (message) =>
                      message.id !== sourceMessageId &&
                      message.role !== "system",
                  )
                  .map((message) => `[${message.role}]\n${message.body}`)
                  .join("\n\n")}\n\n[Current request]\n${sharedRequest.prompt}`
              : sharedRequest.prompt;
            return grokWorkbench.start(
              runId,
              {
                ...sharedRequest,
                prompt: conversationPrompt,
                cli: "grok",
                providerSessionId,
                onAutomationProposal,
                requiredSkillIdentifier: interactiveSlashSkillIdentifier,
                beforeTurn: () => {
                  const currentExecutionRoot =
                    store.assertWorkspaceExecutionRoot(workspaceId);
                  assertPreparedChatAttachmentsCurrent(
                    workspaceId,
                    chatId,
                    preparedAttachments.sources,
                  );
                  assertPreparedProviderFilesCurrent(
                    preparedAttachments.fileBlocks,
                    currentExecutionRoot,
                  );
                },
                onSession: (sessionId) => {
                  store.bindProviderSession({
                    workspaceId,
                    chatId,
                    provider: "grok",
                    providerSessionId: sessionId,
                    executionRoot: canonicalExecutionRoot,
                    securityProfileId: profile.id,
                    model,
                  });
                },
                onApproval: (request, signal) =>
                  awaitProviderDecision(
                    {
                      workspaceId,
                      chatId,
                      executionId: runId,
                      provider: "grok",
                      request,
                    },
                    signal,
                  ),
              },
              onEvent,
            );
          }
          const existing = store.providerSession(
              workspaceId,
              chatId,
              "claude",
            ) as
              | {
                  status: string;
                  executionRoot: string;
                  securityProfileId: string;
                  model?: string;
                  providerSessionId: string;
                }
              | undefined,
            providerSessionId =
              existing?.status === "active" &&
              existing.executionRoot === profile.roots[0] &&
              existing.securityProfileId === profile.id &&
              (existing.model ?? undefined) === model
                ? String(existing.providerSessionId)
                : undefined;
          return claudeWorkbench.start(
            runId,
            {
              ...sharedRequest,
              cli: "claude",
              providerSessionId,
              onAutomationProposal,
              beforeTurn: () => {
                const currentExecutionRoot =
                  store.assertWorkspaceExecutionRoot(workspaceId);
                assertPreparedChatAttachmentsCurrent(
                  workspaceId,
                  chatId,
                  preparedAttachments.sources,
                );
                assertPreparedProviderFilesCurrent(
                  preparedAttachments.fileBlocks,
                  currentExecutionRoot,
                );
              },
              onSession: (sessionId) => {
                store.bindProviderSession({
                  workspaceId,
                  chatId,
                  provider: "claude",
                  providerSessionId: sessionId,
                  executionRoot: canonicalExecutionRoot,
                  securityProfileId: profile.id,
                  model,
                });
              },
              onApproval: (request, signal) =>
                awaitProviderDecision(
                  {
                    workspaceId,
                    chatId,
                    executionId: runId,
                    provider: "claude",
                    request,
                  },
                  signal,
                ),
            },
            onEvent,
          );
        },
        markRunning: (child) =>
          store.startExecution(
            runId,
            workspaceId,
            child.executable,
            child.version,
          ),
      });
      if (cli === "codex" && !parentExecutionId)
        activeCodexChats.set(`${workspaceId}:${chatId}`, {
          runId,
          profileId,
          model: selectedModel,
          reasoningEffort,
        });
      void running.completion
        .then(async (result) => {
          let answerOverride: string | undefined;
          if (result.status === "completed" && nativeAutomationSummary) {
            const answer = canonicalExecutionText(
              cli as "codex" | "claude" | "grok",
              fallbackEvents,
            );
            answerOverride = answer.includes(nativeAutomationSummary)
              ? answer
              : `${answer}${answer ? "\n\n" : ""}${nativeAutomationSummary}`;
          } else if (
            result.status === "completed" &&
            !parentExecutionId &&
            !nativeAutomationPrepared
          ) {
            const parsed = extractAutomationProposalTool(
              canonicalExecutionText(
                cli as "codex" | "claude" | "grok",
                fallbackEvents,
              ),
            );
            if (parsed.definition) {
              try {
                const proposal = await prepareAutomationProposal(
                  workspaceId,
                  chatId,
                  parsed.definition,
                );
                answerOverride = `${parsed.displayAnswer}${parsed.displayAnswer ? "\n\n" : ""}${automationProposalPreparedSummary(proposal.definition)}`;
              } catch (error) {
                answerOverride = `${parsed.displayAnswer}${parsed.displayAnswer ? "\n\n" : ""}I could not prepare the confirmation card: ${error instanceof Error ? error.message : "proposal preparation failed"}. The automation was not created or provisioned. Repository or tool changes completed earlier in this run were not rolled back.`;
              }
            } else if (parsed.error)
              answerOverride = `${parsed.displayAnswer}${parsed.displayAnswer ? "\n\n" : ""}I could not prepare the confirmation card: ${parsed.error}. The automation was not created or provisioned. Repository or tool changes completed earlier in this run were not rolled back.`;
          }
          return finalizeExecution(store, {
            runId,
            workspaceId,
            chatId,
            cli: cli as "codex" | "claude" | "grok",
            result,
            fallbackEvents,
            answerOverride,
          });
        })
        .catch((error) =>
          console.error("Failed to persist terminal execution state", error),
        )
        .finally(() => {
          preparedAttachments.cleanup();
          providerDecisionGate.clearExecution(runId);
          if (cli === "codex") {
            const key = `${workspaceId}:${chatId}`;
            if (activeCodexChats.get(key)?.runId === runId)
              activeCodexChats.delete(key);
          }
        });
      return {
        runId,
        status: "running",
        attachmentDelivery: { passedToCli, unsupported },
      };
    } catch (error) {
      preparedAttachments.cleanup();
      providerDecisionGate.clearExecution(runId);
      try {
        store.failQueuedExecution(
          runId,
          workspaceId,
          error instanceof Error ? error.message : "Unknown execution error",
        );
      } catch {
        /* Preserve the original startup error. */
      }
      throw error;
    }
  });
  handle("waypoint:cancel-execution", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      workspaceId = text(value.workspaceId, "workspace ID", 64),
      runId = text(value.runId, "execution ID", 64);
    if (!store.executionExists(workspaceId, runId))
      throw new Error("Execution not found in workspace");
    const targets = [
      runId,
      ...store
        .listExecutions(workspaceId)
        .filter(
          (item) =>
            item.parentExecutionId === runId &&
            ["queued", "running"].includes(String(item.status)),
        )
        .map((item) => String(item.id)),
    ];
    return {
      canceled: targets
        .map(
          (id) =>
            store.cancelQueuedExecution(workspaceId, id) ||
            codexWorkbench.cancel(id) ||
            claudeWorkbench.cancel(id) ||
            grokWorkbench.cancel(id) ||
            workbench.cancel(id),
        )
        .some(Boolean),
    };
  });
  handle("waypoint:create-chat", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.createChat(
      text(value.workspaceId, "workspace ID", 64),
      text(value.title, "title", 300),
    );
  });
  handle("waypoint:capture-chat", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.captureChat(
      text(value.workspaceId, "workspace ID", 64),
      text(value.title, "title", 300),
      text(value.body, "body"),
    );
  });
  handle("waypoint:add-message", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    const role = text(value.role, "role", 20);
    if (!["user", "assistant", "system"].includes(role))
      throw new Error("Invalid role");
    const attachmentIds = Array.isArray(value.attachmentIds)
      ? value.attachmentIds.map((item) => text(item, "attachment ID", 64))
      : [];
    return store.addMessage(
      text(value.workspaceId, "workspace ID", 64),
      text(value.chatId, "chat ID", 64),
      role as "user" | "assistant" | "system",
      text(value.body, "body"),
      attachmentIds,
    );
  });
  handle("waypoint:list-memories", (_event, input: unknown) =>
    store.listMemories(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:scan-memory-suggestions", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return {
      created: store.scanMemorySuggestions(
        text(value.workspaceId, "workspace ID", 64),
        value.chatId ? text(value.chatId, "chat ID", 64) : undefined,
      ),
    };
  });
  handle("waypoint:list-memory-suggestions", (_event, input: unknown) =>
    store.listMemorySuggestions(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:resolve-memory-suggestion", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      action = text(value.action, "suggestion action", 16);
    if (action !== "accept" && action !== "reject")
      throw new Error("Invalid suggestion action");
    return store.resolveMemorySuggestion(
      text(value.workspaceId, "workspace ID", 64),
      text(value.suggestionId, "suggestion ID", 64),
      action,
      value.title !== undefined && value.body !== undefined
        ? {
            title: text(value.title, "suggestion title", 300),
            body: text(value.body, "suggestion body", 10_000),
          }
        : undefined,
    );
  });
  handle("waypoint:list-commitments", (_event, input: unknown) =>
    store.listCommitments(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:set-commitment-completed", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.setCommitmentCompleted(
      text(value.workspaceId, "workspace ID", 64),
      text(value.commitmentId, "commitment ID", 64),
      value.completed === true,
    );
    return { ok: true };
  });
  handle("waypoint:compose-daily-briefing", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.composeDailyBriefing(
      text(value.workspaceId, "workspace ID", 64),
      text(value.timezone, "timezone", 100),
    );
  });
  handle("waypoint:dismiss-briefing-item", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      kind = text(value.sourceKind, "source kind", 20);
    if (!["commitment", "document", "memory"].includes(kind))
      throw new Error("Invalid briefing source kind");
    store.dismissBriefingItem(
      text(value.workspaceId, "workspace ID", 64),
      text(value.sourceId, "source ID", 64),
      kind as "commitment" | "document" | "memory",
      text(value.localDay, "local day", 10),
    );
    return { ok: true };
  });
  handle("waypoint:scan-rule-suggestions", (_event, input: unknown) => ({
    created: store.scanRuleSuggestions(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  }));
  handle("waypoint:list-rule-suggestions", (_event, input: unknown) =>
    store.listRuleSuggestions(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:dry-run-rule-suggestion", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.dryRunRuleSuggestion(
      text(value.workspaceId, "workspace ID", 64),
      text(value.suggestionId, "suggestion ID", 64),
    );
  });
  handle("waypoint:resolve-rule-suggestion", (_event, input: unknown) => {
    const value = input as Record<string, unknown>,
      action = text(value.action, "rule action", 16);
    if (action !== "approve" && action !== "reject")
      throw new Error("Invalid rule action");
    store.resolveRuleSuggestion(
      text(value.workspaceId, "workspace ID", 64),
      text(value.suggestionId, "suggestion ID", 64),
      action,
    );
    return { ok: true };
  });
  handle("waypoint:list-learned-rules", (_event, input: unknown) =>
    store.listLearnedRules(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    ),
  );
  handle("waypoint:set-learned-rule-enabled", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.setLearnedRuleEnabled(
      text(value.workspaceId, "workspace ID", 64),
      text(value.ruleId, "rule ID", 64),
      value.enabled === true,
    );
    return { ok: true };
  });
  handle("waypoint:revert-learned-rule", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    store.revertLearnedRule(
      text(value.workspaceId, "workspace ID", 64),
      text(value.ruleId, "rule ID", 64),
    );
    return { ok: true };
  });
  handle("waypoint:create-memory", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.createMemory(
      text(value.workspaceId, "workspace ID", 64),
      text(value.title, "title", 300),
      text(value.body, "body", 2_000_000),
      value.sourceObjectId
        ? text(value.sourceObjectId, "source ID", 64)
        : undefined,
    );
  });
  handle("waypoint:capture-memory", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.captureMemory(
      text(value.workspaceId, "workspace ID", 64),
      text(value.title, "title", 300),
      text(value.body, "body", 2_000_000),
      value.sourceObjectId
        ? text(value.sourceObjectId, "source ID", 64)
        : undefined,
      value.sourceOwned === true ? "source-owned" : "workspace-owned",
    );
  });
  handle("waypoint:create-relationship", (_event, input: unknown) => {
    const value = input as Record<string, unknown>;
    return store.createRelationship(
      text(value.workspaceId, "workspace ID", 64),
      text(value.fromId, "source ID", 64),
      text(value.toId, "target ID", 64),
      text(value.type, "relationship type", 80),
    );
  });
  handle("waypoint:export-workspace", async (_event, input: unknown) => {
    const workspaceId = text(
      (input as Record<string, unknown>).workspaceId,
      "workspace ID",
      64,
    );
    const chosen = await dialog.showSaveDialog({
      title: "Back up Waypoint workspace",
      defaultPath: "waypoint-backup.json",
      filters: [{ name: "Waypoint backup", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    const result = writeAtomicBackup(
      chosen.filePath,
      store.exportWorkspace(workspaceId),
    );
    return { canceled: false, ...result };
  });
  handle("waypoint:verify-backup", async () => {
    const chosen = await dialog.showOpenDialog({
      title: "Verify Waypoint backup",
      properties: ["openFile"],
      filters: [{ name: "Waypoint backup", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
    return {
      canceled: false,
      ...(await runBackupAdministration("verify", chosen.filePaths[0])),
    };
  });
  handle("waypoint:drill-backup", async () => {
    const chosen = await dialog.showOpenDialog({
      title: "Test-restore a Waypoint backup",
      properties: ["openFile"],
      filters: [{ name: "Waypoint backup", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
    return {
      canceled: false,
      ...(await runBackupAdministration("drill", chosen.filePaths[0])),
    };
  });
  handle("waypoint:restore-workspace", async () => {
    const chosen = await dialog.showOpenDialog({
      title: "Restore Waypoint backup as a new workspace",
      properties: ["openFile"],
      filters: [{ name: "Waypoint backup", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
    const archive = readBackup(chosen.filePaths[0]);
    const base = path.basename(chosen.filePaths[0], ".json");
    return {
      canceled: false,
      workspace: store.restoreWorkspace(
        archive,
        `${base} restored`,
        app.getPath("userData"),
      ),
    };
  });
  handle("waypoint:diagnostics", async (_event, input: unknown) => {
    return collectDiagnostics(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    );
  });
  handle("waypoint:rebuild-search", (_event, input: unknown) => {
    store.rebuildTextIndex(
      text((input as Record<string, unknown>).workspaceId, "workspace ID", 64),
    );
    return { ok: true };
  });
  handle("waypoint:export-diagnostics", async (_event, input: unknown) => {
    const workspaceId = text(
        (input as Record<string, unknown>).workspaceId,
        "workspace ID",
        64,
      ),
      payload = exportDiagnosticsReport(await collectDiagnostics(workspaceId));
    const chosen = await dialog.showSaveDialog({
      title: "Save local diagnostic report",
      defaultPath: "waypoint-diagnostics.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    const temporary = `${chosen.filePath}.partial-${randomUUID()}`;
    try {
      writeFileSync(temporary, payload, { flag: "wx", mode: 0o600 });
      renameSync(temporary, chosen.filePath);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    return { canceled: false };
  });
}

function createWindow(): void {
  const statePath = path.join(app.getPath("userData"), "window-state.json"),
    fallback = { x: 130, y: 70, width: 1180, height: 760 };
  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    /* First launch or invalid local state uses a safe visible default. */
  }
  const displays = screen
    .getAllDisplays()
    .map((display) => ({ id: String(display.id), workArea: display.workArea }));
  const restored = restoreWindowState(saved, displays, fallback);
  const window = new BrowserWindow({
    ...restored.bounds,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "waypoint.png")
      : path.join(currentDirectory, "../../build/icons/waypoint.png"),
    minWidth: 840,
    minHeight: 620,
    backgroundColor: "#111b19",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    const parsed = new URL(developmentUrl);
    if (
      parsed.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password
    )
      throw new Error(
        "Development server must be an unauthenticated HTTP loopback URL",
      );
  }
  const allowedUrl = developmentUrl
    ? new URL(developmentUrl).href
    : pathToFileURL(path.join(currentDirectory, "../../dist/index.html")).href;
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      const trusted =
          contents.id === window.webContents.id &&
          details.requestingUrl === allowedUrl,
        mediaTypes =
          "mediaTypes" in details && Array.isArray(details.mediaTypes)
            ? details.mediaTypes
            : [];
      callback(
        Boolean(
          trusted &&
          permission === "media" &&
          mediaTypes.length === 1 &&
          mediaTypes[0] === "audio",
        ),
      );
    },
  );
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (target !== allowedUrl) event.preventDefault();
  });
  if (developmentUrl) void window.loadURL(developmentUrl);
  else
    void window.loadFile(path.join(currentDirectory, "../../dist/index.html"));
  trustedSenderId = window.webContents.id;
  trustedRendererUrl = allowedUrl;
  if (restored.maximized) window.maximize();
  let timer: NodeJS.Timeout | undefined,
    lastNormalBounds: WindowBounds = restored.bounds,
    resizing = false,
    expanded = restored.maximized;
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const current = window.getBounds(),
        display = screen.getDisplayMatching(current),
        maximized =
          expanded ||
          window.isMaximized() ||
          window.isFullScreen() ||
          isEffectivelyMaximized(current, display.workArea);
      if (!maximized && !resizing) lastNormalBounds = current;
      const state: SavedWindowState = {
        bounds: maximized ? lastNormalBounds : current,
        displayId: String(display.id),
        maximized,
      };
      const temporary = `${statePath}.partial`;
      try {
        writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
        renameSync(temporary, statePath);
      } catch (error) {
        rmSync(temporary, { force: true });
        console.error("Failed to persist window state", error);
      }
    }, 180);
  };
  window.on("will-resize", () => {
    if (!resizing) {
      const current = window.getBounds(),
        display = screen.getDisplayMatching(current);
      if (
        !window.isMaximized() &&
        !isEffectivelyMaximized(current, display.workArea)
      )
        lastNormalBounds = current;
    }
    resizing = true;
  });
  window.on("resized", () => {
    resizing = false;
    persist();
  });
  window.on("move", persist);
  window.on("resize", persist);
  window.on("maximize", () => {
    expanded = true;
    persist();
  });
  window.on("unmaximize", () => {
    expanded = false;
    persist();
  });
  window.on("enter-full-screen", () => {
    expanded = true;
    persist();
  });
  window.on("leave-full-screen", () => {
    expanded = false;
    persist();
  });
  window.on("close", () => {
    if (timer) clearTimeout(timer);
    const current = window.getBounds(),
      display = screen.getDisplayMatching(current),
      maximized =
        expanded ||
        window.isMaximized() ||
        window.isFullScreen() ||
        isEffectivelyMaximized(current, display.workArea);
    const state: SavedWindowState = {
      bounds: maximized ? lastNormalBounds : current,
      displayId: String(display.id),
      maximized,
    };
    const temporary = `${statePath}.partial`;
    try {
      writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
      renameSync(temporary, statePath);
    } catch (error) {
      rmSync(temporary, { force: true });
      console.error("Failed to persist window state", error);
    }
  });
}

if (process.platform === "win32") {
  app.setPath(
    "userData",
    canonicalWindowsUserData(process.env, app.getPath("home")),
  );
  app.setAppUserModelId("com.waypoint.desktop");
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(() => {
    initializeRunScopedAttachmentOwnership(app.getPath("userData"));
    cleanupStaleGrokAutomationDirectories();
    if (app.isPackaged && process.platform === "win32")
      cleanupLegacyWindowsInstall({
        localAppData:
          process.env.LOCALAPPDATA ??
          path.join(app.getPath("home"), "AppData", "Local"),
        currentExecutable: process.execPath,
      });
    store = new WorkspaceStore(
      path.join(app.getPath("userData"), "waypoint.sqlite"),
    );
    cleanupRunScopedAttachmentDirectories(
      managedWorkspaceExecutionRoots(store),
    );
    try {
      productHelpLibrary = loadProductHelp(
        app.isPackaged
          ? path.join(process.resourcesPath, "waypoint-help")
          : path.resolve(currentDirectory, "../../vendor/product-help"),
      );
    } catch (error) {
      productHelpLibrary = undefined;
      console.error(
        "Waypoint Help is unavailable",
        error instanceof Error ? error.message : "integrity check failed",
      );
    }
    meetingPlaybackCacheRoot = path.join(
      app.getPath("userData"),
      "meeting-playback-cache",
    );
    rmSync(meetingPlaybackCacheRoot, { recursive: true, force: true });
    const automationProvisioningTempRoot = path.join(
      app.getPath("userData"),
      "automation-provisioning-tmp",
    );
    rmSync(automationProvisioningTempRoot, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 50,
    });
    mkdirSync(automationProvisioningTempRoot, { recursive: true, mode: 0o700 });
    registerMeetingPlaybackProtocol();
    try {
      browserClosure = verifyBrowserClosure(
        app.isPackaged
          ? path.join(process.resourcesPath, "agent-browser")
          : path.resolve(currentDirectory, "../../vendor/browser-staging"),
      );
      browserClosureError = "";
    } catch (error) {
      browserClosure = undefined;
      browserClosureError = `Unavailable: ${error instanceof Error ? error.message : "browser_integrity_failed"}`;
    }
    const voiceRoot = app.isPackaged
      ? path.join(process.resourcesPath, "voice")
      : path.resolve(currentDirectory, "../../vendor/voice/macos-arm64");
    voiceRuntime = new VoiceRuntimeRegistry(
      path.join(app.getPath("userData"), "voice-runtime.json"),
      process.platform,
      undefined,
      {
        binaryPath: path.join(voiceRoot, "bin/waypoint-whisper"),
        modelPath: path.join(voiceRoot, "ggml-base.en-q5_1.bin"),
        frameworkPath: path.join(
          voiceRoot,
          "Frameworks/whisper.framework/Versions/A/whisper",
        ),
        label: "Whisper base.en q5_1",
        binarySha256:
          "f74342a44a2addfafcfd30ba74f8bbdeef4044d82f530ae58f49fc20e6d79b4a",
        modelSha256:
          "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f",
        frameworkSha256:
          "9664726a3ecf1d9fdadcbc731b9dba3b5bbeea184d42797e044a347c2b7c8ea5",
      },
      process.arch,
      process.getSystemVersion(),
    );
    voicePacks = new VoicePackManager(
      path.join(app.getPath("userData"), "voice-packs"),
    );
    const fastAssetsRoot = app.isPackaged
        ? path.join(process.resourcesPath, "fast-local")
        : path.resolve(
            currentDirectory,
            "../../vendor/voice/fast-local-staging",
          ),
      fastVoiceRoot = path.join(fastAssetsRoot, "kitten"),
      nativeVoicePackage = `sherpa-onnx-${process.platform === "win32" ? "win" : "darwin"}-${process.arch}`;
    fastVoiceSpeech = new FastLocalSpeechProcessAdapter(
      fastVoiceRoot,
      path.join(currentDirectory, "core/fast-local-speech-worker.js"),
    );
    fastVoiceTranscription = new FastLocalTranscriptionProcessAdapter(
      path.join(fastAssetsRoot, "whisper-tiny.en"),
      path.join(currentDirectory, "core/fast-local-transcription-worker.js"),
    );
    meetingTranscription = new FastLocalTranscriptionProcessAdapter(
      path.join(fastAssetsRoot, "whisper-tiny.en"),
      path.join(currentDirectory, "core/fast-local-transcription-worker.js"),
    );
    fastVoicePackageBytes =
      directoryBytes(fastAssetsRoot) +
      directoryBytes(
        app.isPackaged
          ? path.join(
              process.resourcesPath,
              "app.asar.unpacked/node_modules",
              nativeVoicePackage,
            )
          : path.resolve(
              currentDirectory,
              "../../node_modules",
              nativeVoicePackage,
            ),
      );
    providerVault = new ProtectedProviderVault(app.getPath("userData"), {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    });
    webSearchVault = new ProtectedWebSearchVault(app.getPath("userData"), {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    });
    toolFailureFingerprintKey = loadToolFailureFingerprintKey();
    const vault = new ProtectedSyncVault(
      path.join(app.getPath("userData"), "sync-secrets"),
      {
        available: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(Buffer.from(value)),
      },
    );
    syncVault = vault;
    inAppBrowser = new InAppBrowserController((workspaceId, state) => {
      for (const window of BrowserWindow.getAllWindows())
        if (toolWindowWorkspaces.get(window.webContents.id) === workspaceId)
          window.webContents.send("waypoint:in-app-browser-state", state);
    });
    toolGateway = new ToolGateway({
      domain: async (workspaceId, command, input, origin) => {
        if (command === "rollup.compose") {
          const requested = Array.isArray(input.families)
            ? input.families
                .map(String)
                .filter(
                  (
                    item,
                  ): item is "commitments" | "meetings" | "briefing_status" =>
                    ["commitments", "meetings", "briefing_status"].includes(
                      item,
                    ),
                )
            : undefined;
          return {
            value: store.composeCrossWorkspaceRollup(
              workspaceId,
              requested,
              true,
            ),
            summary: "Composed an explicitly granted cross-workspace roll-up",
          };
        }
        if (command === "workspace.summary")
          return {
            value: {
              workspace: store
                .listWorkspaces()
                .find((item) => item.id === workspaceId),
              chats: store.listChats(workspaceId).length,
              documents: store.listDocuments(workspaceId).length,
              memories: store.listMemories(workspaceId).length,
            },
            summary: "Read workspace summary",
          };
        if (command === "automation.connectors.list")
          return {
            value: WEBHOOK_CONNECTORS,
            summary: "Listed supported webhook connector contracts",
          };
        if (command === "automation.proposal.create") {
          const chatId =
            typeof input.chatId === "string"
              ? text(input.chatId, "chat ID", 64)
              : undefined;
          const proposal = await prepareAutomationProposal(
            workspaceId,
            chatId,
            input.definition,
          );
          return {
            value: {
              proposalId: proposal.id,
              status: proposal.status,
              proposalDigest: proposal.proposalDigest,
              question: proposal.question,
            },
            summary: automationProposalPreparedSummary(proposal.definition),
          };
        }
        if (command === "browser.status") {
          const settings = store.toolGatewaySettings(workspaceId),
            surface = inAppBrowser.status(workspaceId);
          return {
            value: {
              mode: settings.browserProfileMode,
              profile: settings.browserProfileName,
              allowedDomains: settings.browserAllowedDomains,
              stopped: settings.stopped,
              surface,
            },
            summary: "Read browser readiness and policy status",
          };
        }
        if (command === "browser.domains.update") {
          const current = store.toolGatewaySettings(workspaceId),
            domains = Array.isArray(input.domains)
              ? input.domains.map((item) => text(item, "browser domain", 253))
              : [];
          const next = store.setToolGatewaySettings(workspaceId, {
            ...current,
            browserAllowedDomains: domains,
          });
          return {
            value: { allowedDomains: next.browserAllowedDomains },
            summary: "Updated browser public-domain policy",
          };
        }
        if (command === "screen_capture.status") {
          return {
            value: {
              settings: store.screenCaptureSettings(workspaceId),
              captures: store
                .listScreenCaptures(workspaceId)
                .map(({ id, title, mode, capturedAt, expiresAt, bytes }) => ({
                  id,
                  title,
                  mode,
                  capturedAt,
                  expiresAt,
                  bytes,
                })),
              readiness: captureReadiness(
                process.platform,
                process.platform === "darwin"
                  ? (systemPreferences.getMediaAccessStatus("screen") as
                      | "granted"
                      | "denied"
                      | "restricted"
                      | "not-determined"
                      | "unknown")
                  : "unknown",
              ),
            },
            summary: "Read manual local screenshot status",
          };
        }
        if (command === "screen_capture.settings.update") {
          const current = store.screenCaptureSettings(workspaceId),
            next = store.setScreenCaptureSettings(
              workspaceId,
              validateCaptureSettings({
                workflow: (input.workflow ??
                  current.workflow) as CaptureSettings["workflow"],
                mode: (input.mode ?? current.mode) as CaptureMode,
                shortcut: String(input.shortcut ?? current.shortcut),
                retentionDays: Number(
                  input.retentionDays ?? current.retentionDays,
                ) as 7 | 30 | 90,
                maxCaptures: Number(input.maxCaptures ?? current.maxCaptures),
              }),
            );
          registerCaptureShortcut(workspaceId, next);
          return { value: next, summary: "Updated manual screenshot settings" };
        }
        if (command === "screen_capture.open") {
          BrowserWindow.getAllWindows()[0]?.webContents.send(
            "waypoint:screen-capture-request",
          );
          return {
            value: { opened: true },
            summary:
              "Opened the manual screenshot picker; the user must choose a source",
          };
        }
        if (command === "chat.create") {
          const id = store.createChat(
            workspaceId,
            text(input.title, "chat title", 300),
          );
          return {
            value: { chatId: id },
            summary: "Created chat",
            rollbackRef: `delete:chat:${id}`,
          };
        }
        if (command === "memory.create") {
          const id = store.createMemory(
            workspaceId,
            text(input.title, "memory title", 300),
            text(input.body, "memory body", 10_000),
          );
          return {
            value: { memoryId: id },
            summary: "Created memory",
            rollbackRef: `delete:memory:${id}`,
          };
        }
        if (command === "provider.preferences.update") {
          const current = store.openRouterSettings(),
            next = store.setOpenRouterSettings({
              ...current,
              strategicModel:
                input.strategicModel === undefined
                  ? current.strategicModel
                  : text(input.strategicModel, "strategic model ID", 200),
              everydayModel:
                input.everydayModel === undefined
                  ? current.everydayModel
                  : text(input.everydayModel, "everyday model ID", 200),
              attachmentModel:
                input.attachmentModel === undefined
                  ? current.attachmentModel
                  : text(input.attachmentModel, "image model ID", 200),
              fallbackProvider: ["codex", "claude", "grok"].includes(
                String(input.fallbackProvider),
              )
                ? (input.fallbackProvider as "codex" | "claude" | "grok")
                : current.fallbackProvider,
              monthlyCapMicros:
                input.monthlyCapMicros === undefined
                  ? current.monthlyCapMicros
                  : Number(input.monthlyCapMicros),
              ytdCapMicros:
                input.ytdCapMicros === undefined
                  ? current.ytdCapMicros
                  : Number(input.ytdCapMicros),
              warningPercent:
                input.warningPercent === undefined
                  ? current.warningPercent
                  : Number(input.warningPercent),
            });
          return {
            value: {
              ...next,
              enabled: undefined,
              liveRequestsEnabled: undefined,
            },
            summary: "Updated non-security provider preferences",
          };
        }
        throw new Error(
          origin === "ai"
            ? "tool_domain_command_unavailable"
            : "Unknown domain command",
        );
      },
      progress: (event) => {
        for (const window of BrowserWindow.getAllWindows())
          if (
            toolWindowWorkspaces.get(window.webContents.id) ===
            event.workspaceId
          )
            window.webContents.send("waypoint:tool-gateway-progress", event);
      },
      complete: (result) => {
        store.saveToolReceipt(result.receipt);
      },
      preflight: (request) => {
        const material = toolFailureKeyFor(request.workspaceId, vault);
        return store.findToolFailure(
          request.workspaceId,
          failureIdentity(
            material.key,
            request,
            material.capabilityVersion,
            localFailureContext(),
          ),
        );
      },
      learn: (request, result, overrideReason, remediation) => {
        const material = toolFailureKeyFor(request.workspaceId, vault);
        store.recordToolOutcome(
          request,
          failureIdentity(
            material.key,
            request,
            material.capabilityVersion,
            localFailureContext(),
          ),
          result,
          safeFailureNote(overrideReason),
          safeFailureNote(remediation),
        );
      },
    });
    toolGateway.configureWeb(async (request, signal) => {
      if (request.tool === "web.fetch") {
        const result = await controlledWebTools.fetchPage({
          url: text(request.arguments.url, "web URL", 2048),
          signal,
        });
        return {
          output: result.output,
          summary: result.summary,
          value: {
            sourceUrls: result.sourceUrls,
            contentType: result.contentType,
            status: result.status,
          },
        };
      }
      const result = await controlledWebTools.search({
        query: text(request.arguments.query, "web search query", 500),
        count:
          request.arguments.count === undefined
            ? 5
            : Number(request.arguments.count),
        apiKey: webSearchVault.getKey(),
        signal,
      });
      return {
        output: result.output,
        summary: result.summary,
        value: { sourceUrls: result.sourceUrls },
      };
    });
    toolGateway.configureBrowser(
      async (workspaceId, action, workspaceRoot, signal) => {
        if (!inAppBrowser.status(workspaceId).open) {
          if (action.command !== "open")
            throw new Error("Open the Waypoint In-App Browser first");
          const host = BrowserWindow.getAllWindows()[0],
            settings = store.toolGatewaySettings(workspaceId);
          if (!host) throw new Error("browser_window_unavailable");
          const [width, height] = host.getContentSize();
          await inAppBrowser.open(
            workspaceId,
            host,
            action.url,
            settings.browserAllowedDomains,
            {
              x: 300,
              y: 130,
              width: Math.max(500, width - 340),
              height: Math.max(360, height - 260),
            },
            signal,
          );
          return {
            summary: "Opened URL in Waypoint In-App Browser",
            output: action.url,
          };
        }
        return inAppBrowser.action(workspaceId, action, workspaceRoot, signal);
      },
    );
    peerHostRuntime = new PeerHostRuntime(
      path.join(app.getPath("userData"), "peer-host"),
      vault,
    );
    void DesktopSyncService.create(vault, peerHostRuntime)
      .then((service) => {
        syncService = service;
        registerIpc();
        createWindow();
        const initialWorkspace = store.listWorkspaces()[0];
        if (initialWorkspace)
          registerCaptureShortcut(
            initialWorkspace.id,
            store.screenCaptureSettings(initialWorkspace.id),
          );
        const timer = setInterval(() => {
          for (const workspace of store.listWorkspaces()) {
            const syncStatus = syncService.status(workspace.id);
            if (
              !syncStatus.configured ||
              (syncStatus.transportMode === "desktop-host" &&
                !syncStatus.peerHost?.running)
            )
              continue;
            if (!activeSyncRuns.has(workspace.id)) {
              activeSyncRuns.add(workspace.id);
              const signal = AbortSignal.any([
                syncAbort.signal,
                AbortSignal.timeout(20_000),
              ]);
              void syncService
                .syncOnce(workspace.id, store, signal)
                .then(() => processRemoteJobs(workspace.id))
                .catch((error) => {
                  if (!syncAbort.signal.aborted)
                    console.warn(
                      "Workspace sync attempt failed",
                      error instanceof Error ? error.message : "unknown",
                    );
                })
                .finally(() => activeSyncRuns.delete(workspace.id));
            }
            if (!activeWebhookRuns.has(workspace.id)) {
              activeWebhookRuns.add(workspace.id);
              const signal = AbortSignal.any([
                syncAbort.signal,
                AbortSignal.timeout(20_000),
              ]);
              void syncService
                .fetchWebhookEvents(workspace.id, store, signal)
                .then(async (result) => {
                  if (result.imported > 0)
                    captureWindow()?.webContents.send(
                      "waypoint:webhook-events-imported",
                      { workspaceId: workspace.id, imported: result.imported },
                    );
                  await processAutomationRunsV2(workspace.id);
                })
                .catch((error) => {
                  if (!syncAbort.signal.aborted)
                    console.warn(
                      "Workspace webhook receive failed",
                      error instanceof Error ? error.message : "unknown",
                    );
                })
                .finally(() => activeWebhookRuns.delete(workspace.id));
            }
          }
        }, 5_000);
        timer.unref();
      })
      .catch((error) => {
        console.error("Protected sync startup failed", error);
        dialog.showErrorBox(
          "Waypoint protected storage unavailable",
          "Sync requires macOS Keychain or Windows DPAPI. Waypoint cannot start sync safely on this device.",
        );
        app.quit();
      });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  let shutdownStarted = false;
  app.on("before-quit", (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    globalShortcut.unregisterAll();
    syncAbort.abort();
    providerModelCatalogAbort.abort();
    for (const active of activeAutoTitles.values()) active.cancel();
    const browserShutdown = Promise.all(
      (store?.listWorkspaces() ?? []).map((workspace) =>
        toolGateway.stopAndCloseBrowser(
          workspace.id,
          gatewayPolicy(workspace.id),
        ),
      ),
    );
    void Promise.allSettled([
      workbench.shutdown(),
      codexWorkbench.shutdown(),
      claudeWorkbench.shutdown(),
      grokWorkbench.shutdown(),
      shutdownInstalledCliModelCatalog(),
      browserShutdown,
      peerHostRuntime?.stop(),
      Promise.allSettled([...activeAutoTitleTasks]),
    ]).finally(() => {
      store?.close();
      app.exit(0);
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
