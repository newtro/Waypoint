import {
  type ClipboardEvent,
  FormEvent,
  Fragment,
  lazy,
  Suspense,
  StrictMode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type {
  ActivityFamily,
  ActivityTimelineItem,
  AttachmentMetadata,
  SanitizedSyncStatus,
  WorkspaceSummary,
} from "../electron/core/types";
import type { DiagnosticsReport } from "../electron/core/diagnostics";
import {
  executionAnswerText,
  failureAdvice,
  type ExecutionRunView,
} from "./ai-workbench-ui";
import { reconcileSelectedChatId, RefreshGate } from "./chat-selection";
import { groupChatHistory, type HistorySort } from "./chat-history";
import { HotkeyRecorder } from "./hotkey-recorder";
import {
  addMainTab,
  chatTab,
  closeMainTabs,
  nextActiveMainTabId,
  viewTab,
  type MainTab,
  type TabCloseAction,
  type WorkspaceView,
} from "./main-tabs";
import waypointMark from "./assets/waypoint-mark.svg";
import "./styles.css";
import "./provider-settings.css";
import "./auto-chat-title.css";
import "./chat-header-actions.css";
import "./chat-attachments.css";
import "./voice-mode.css";
import "./screen-capture.css";
import "./composer-polish.css";
import "./in-app-browser.css";
import "./execution-timeline-polish.css";
import "./main-tabs.css";
import "./settings-workspace.css";
import {
  providerFormField,
  providerFormRequiredReady,
} from "./provider-form.js";
import "./theme.css";
import {
  BrowserPcmCapture,
  BrowserSpeechMonitor,
  BrowserVoicePlayer,
} from "./voice-capture";
import { cancelLateVoiceRun } from "./voice-run-cancellation";
import {
  openRouterImageModelChoices,
  openRouterModelChoices,
  openRouterModelThinking,
} from "../electron/core/openrouter-model-catalog";
import {
  EMPTY_THINKING_PREFERENCES,
  thinkingLabel,
  type ThinkingEffort,
  type ThinkingLane,
  type ThinkingPreferences,
} from "./model-thinking";
import {
  responseNoticeAfterRuns,
  runsForSourceMessage,
  uniqueChatRuns,
  uniqueExecutionEvents,
} from "./chat-run-presentation";
import {
  subscriptionFallbackModel,
  withLegacyModel,
} from "./provider-model-choices";
import { nextOpenRouterActivation } from "./openrouter-activation";
import {
  formatProviderMicros,
  providerCapabilityPresentation,
} from "./provider-settings-presentation";
import { shouldFollowChat } from "./chat-scroll";
import { parseBrowserChatCommand } from "./browser-chat-command";
import { ScreenCaptureStudio } from "./screen-capture-studio";
import { confirmModal, promptModal, ModalDialogHost } from "./modal-dialogs";
import {
  knowledgeShortcutIcon,
  primaryShortcutLabel,
  primaryShortcutPressed,
} from "./platform-shortcuts";
import {
  applyAppearance,
  nextAppearanceFromKey,
  persistAppearance,
  readAppearance,
  resolveAppearance,
  type AppearancePreference,
} from "./theme";
import {
  dispatchOfficeWorkOrder as dispatchConfirmedOfficeWorkOrder,
  refreshAfterOfficeDispatch,
  type OfficeProviderOption,
  type OfficeWorkOrder,
} from "./office/office-work-order";

const appearanceMediaQuery = window.matchMedia("(prefers-color-scheme: dark)"),
  initialAppearance = readAppearance(window.localStorage);
applyAppearance(
  document.documentElement,
  initialAppearance,
  appearanceMediaQuery.matches,
);

const OfficeCommandCenter = lazy(() =>
  import("./office/OfficeCommandCenter").then((module) => ({
    default: module.OfficeCommandCenter,
  })),
);
const ChatMarkdown = lazy(() =>
  import("./chat-markdown").then((module) => ({
    default: module.ChatMarkdown,
  })),
);

function ChatBody({ body }: { body: string }) {
  return (
    <Suspense fallback={<div className="chat-markdown">{body}</div>}>
      <ChatMarkdown body={body} />
    </Suspense>
  );
}

function ThinkingSelect({
  label,
  value,
  supported,
  defaultEffort,
  onChange,
  compact = false,
}: {
  label: string;
  value: ThinkingEffort | "";
  supported: readonly ThinkingEffort[];
  defaultEffort?: ThinkingEffort;
  onChange(value: ThinkingEffort | ""): void;
  compact?: boolean;
}) {
  const legacy = Boolean(value && !supported.includes(value));
  return (
    <label className={compact ? "thinking-field compact" : "thinking-field"}>
      {!compact && <span>{label}</span>}
      <select
        aria-label={label}
        value={value}
        disabled={!supported.length}
        onChange={(event) =>
          onChange(event.target.value as ThinkingEffort | "")
        }
      >
        <option value="">
          {defaultEffort
            ? `Model default · ${thinkingLabel(defaultEffort)}`
            : "Model default"}
        </option>
        {legacy && <option value={value}>Saved legacy · {value}</option>}
        {supported.map((effort) => (
          <option value={effort} key={effort}>
            {thinkingLabel(effort)}
          </option>
        ))}
      </select>
    </label>
  );
}

type VoiceMode = "push_to_talk" | "hands_free";
type VoiceState =
  "off" | "listening" | "transcribing" | "thinking" | "speaking" | "error";

type Chat = Awaited<ReturnType<Window["waypoint"]["listChats"]>>[number];
function browserHostLabel(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "Enter a secure HTTPS address";
  }
}
type Document = Awaited<
  ReturnType<Window["waypoint"]["listDocuments"]>
>[number];
type Memory = Awaited<ReturnType<Window["waypoint"]["listMemories"]>>[number];
type MemorySuggestion = Awaited<
  ReturnType<Window["waypoint"]["listMemorySuggestions"]>
>[number];
type Commitment = Awaited<
  ReturnType<Window["waypoint"]["listCommitments"]>
>[number];
type Briefing = Awaited<ReturnType<Window["waypoint"]["composeDailyBriefing"]>>;
type RuleSuggestion = Awaited<
  ReturnType<Window["waypoint"]["listRuleSuggestions"]>
>[number];
type LearnedRule = Awaited<
  ReturnType<Window["waypoint"]["listLearnedRules"]>
>[number];
type KnowledgeGraph = Awaited<ReturnType<Window["waypoint"]["graph"]>>;
type Meeting = Awaited<ReturnType<Window["waypoint"]["listMeetings"]>>[number];
type TranscriptionCapability = Awaited<
  ReturnType<Window["waypoint"]["meetingTranscriptionCapability"]>
>;
type WebhookChannels = Awaited<
  ReturnType<Window["waypoint"]["webhookChannels"]>
>;
type WebhookEvent = Awaited<
  ReturnType<Window["waypoint"]["listWebhookEvents"]>
>[number];
type AutomationProposal = Awaited<
  ReturnType<Window["waypoint"]["automationProposals"]>
>[number];
type AutomationRuntime = Awaited<
  ReturnType<Window["waypoint"]["automationRulesAndRuns"]>
>;
type ToolSettings = Awaited<
  ReturnType<Window["waypoint"]["toolGatewaySettings"]>
>;
type ToolReceipt = Awaited<
  ReturnType<Window["waypoint"]["toolGatewayReceipts"]>
>[number];
type ToolCapabilities = Awaited<
  ReturnType<Window["waypoint"]["toolGatewayCapabilities"]>
>;
type ToolFailure = Awaited<
  ReturnType<Window["waypoint"]["toolFailures"]>
>[number];
type RollupSettings = Awaited<
  ReturnType<Window["waypoint"]["crossWorkspaceRollupSettings"]>
>;
type OpenRouterStatus = Awaited<
  ReturnType<Window["waypoint"]["openRouterStatus"]>
>;
type OpenRouterThinkingDraft = Pick<
  ThinkingPreferences,
  | "openrouterStrategic"
  | "openrouterEveryday"
  | "openrouterAttachment"
>;
type CliModelCatalog = Awaited<
  ReturnType<Window["waypoint"]["cliModelCatalog"]>
>;
type VoiceCapability = Awaited<
  ReturnType<Window["waypoint"]["voiceCapability"]>
>;
type VoiceEngineStatus = Awaited<
  ReturnType<Window["waypoint"]["voiceEngineStatus"]>
>;
type ActivityCaptureStatus = Awaited<
  ReturnType<Window["waypoint"]["activityCaptureStatus"]>
>;
type ActivitySnapshot = Awaited<
  ReturnType<Window["waypoint"]["listActivitySnapshots"]>
>[number];
type ProviderRequest = Awaited<
  ReturnType<Window["waypoint"]["listProviderRequests"]>
>[number];
type Drawer = WorkspaceView | undefined;

const workspaceViewTitles: Record<WorkspaceView, string> = {
  office: "Command Center",
  briefing: "Briefing",
  knowledge: "Knowledge",
  reflection: "Reflection",
  rules: "Graph & rules",
  meetings: "Meetings",
  automations: "Automations",
  activity: "Activity",
  health: "Health",
  settings: "Settings",
  browser: "In-App Browser",
};

type AttachmentViewer = {
  id: string;
  workspaceId: string;
  chatId: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
};
const profilePreferenceKey = (
  workspaceId: string,
  chatId: string | undefined,
  provider: string,
) =>
  `waypoint:authority-profile:v1:${workspaceId}:${chatId ?? "new"}:${provider}`;

function ChatAttachmentPreview({
  workspaceId,
  chatId,
  attachment,
  queued,
  onOpen,
  onRemove,
}: {
  workspaceId: string;
  chatId: string;
  attachment: AttachmentMetadata;
  queued?: boolean;
  onOpen(viewer: AttachmentViewer): void;
  onRemove?: () => void;
}) {
  const [preview, setPreview] = useState<{
      dataUrl: string;
      width: number;
      height: number;
    }>(),
    [failed, setFailed] = useState(false);
  const image = attachment.mediaType.startsWith("image/");
  const storageLabel = attachment.syncEligible
    ? "stored locally · cross-device eligible"
    : `stored locally only · ${attachment.localOnlyReason === "transport_file_size" ? "over 25 MiB transport limit" : attachment.localOnlyReason === "transport_owner_count" ? "attachment count transport limit" : "workspace transport limit"}`;
  useEffect(() => {
    if (!image) return;
    let active = true;
    void window.waypoint
      .attachmentImagePreview(workspaceId, attachment.id, "thumbnail")
      .then((result) => {
        if (active)
          setPreview({
            dataUrl: `data:${result.mediaType};base64,${result.dataBase64}`,
            width: result.width,
            height: result.height,
          });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attachment.id, image, workspaceId]);
  if (!image)
    return (
      <span className="attachment-file-chip" title={storageLabel}>
        ▧ <b>{attachment.name}</b>
        <small>
          {queued
            ? `${Math.ceil(attachment.bytes / 1024)} KiB · ${storageLabel}`
            : storageLabel}
        </small>
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </span>
    );
  async function open() {
    try {
      const result = await window.waypoint.attachmentImagePreview(
        workspaceId,
        attachment.id,
        "viewer",
      );
      onOpen({
        id: attachment.id,
        workspaceId,
        chatId,
        name: attachment.name,
        dataUrl: `data:${result.mediaType};base64,${result.dataBase64}`,
        width: result.width,
        height: result.height,
      });
    } catch {
      setFailed(true);
    }
  }
  return (
    <figure className={`attachment-image-card${failed ? " failed" : ""}`}>
      <button
        type="button"
        className="attachment-image-open"
        aria-label={`Open full image ${attachment.name}`}
        onClick={() => void open()}
        disabled={failed}
      >
        {preview ? (
          <img
            src={preview.dataUrl}
            width={preview.width}
            height={preview.height}
            alt={`Image attachment: ${attachment.name}`}
          />
        ) : (
          <span className="attachment-image-state">
            {failed ? "Preview unavailable" : "Loading image preview…"}
          </span>
        )}
      </button>
      <figcaption>
        <span title={attachment.name}>{attachment.name}</span>
        <small>
          {failed
            ? "Image missing or corrupt"
            : queued
              ? `${Math.ceil(attachment.bytes / 1024)} KiB · ${storageLabel}`
              : storageLabel}
        </small>
      </figcaption>
      {onRemove && (
        <button
          type="button"
          className="attachment-image-remove"
          aria-label={`Remove ${attachment.name}`}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </figure>
  );
}

function ProviderRequestCard({
  request,
  onDecision,
}: {
  request: ProviderRequest;
  onDecision: (
    status: "accepted" | "accepted_session" | "declined" | "canceled",
    decision?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({}),
    [elicitation, setElicitation] = useState<
      Record<string, string | number | boolean | string[]>
    >({}),
    questions =
      request.kind === "question" && Array.isArray(request.detail.questions)
        ? request.detail.questions.map((item) =>
            item && typeof item === "object"
              ? (item as Record<string, unknown>)
              : {},
          )
        : [];
  if (request.kind === "mcp_elicitation") {
    const schema =
        request.detail.requestedSchema &&
        typeof request.detail.requestedSchema === "object"
          ? (request.detail.requestedSchema as Record<string, unknown>)
          : {},
      properties =
        schema.properties && typeof schema.properties === "object"
          ? (schema.properties as Record<string, unknown>)
          : {},
      required = Array.isArray(schema.required)
        ? schema.required.map(String)
        : [],
      mode = String(request.detail.mode ?? "form"),
      url =
        typeof request.detail.url === "string" ? request.detail.url : undefined,
      ready =
        mode === "url" || providerFormRequiredReady(required, elicitation);
    return (
      <section
        className="automation-confirmation provider-request provider-question-request"
        role="group"
        aria-labelledby={`provider-request-${request.id}`}
      >
        <div>
          <small>{request.provider} · MCP elicitation · waiting</small>
          <strong id={`provider-request-${request.id}`}>{request.title}</strong>
          {mode === "url" && url ? (
            <div className="provider-elicitation-link">
              <p>
                This MCP server needs you to finish a browser step. Waypoint
                will not enter credentials for you.
              </p>
              <button
                type="button"
                onClick={() => void window.waypoint.openExternal(url)}
              >
                Open secure browser step
              </button>
              <code>{url}</code>
            </div>
          ) : (
            <div className="provider-question-list">
              {Object.entries(properties).map(([key, value]) => {
                const field =
                    value && typeof value === "object"
                      ? (value as Record<string, unknown>)
                      : {},
                  { options, multiple } = providerFormField(field),
                  selected = Array.isArray(elicitation[key])
                    ? (elicitation[key] as string[])
                    : [];
                return (
                  <fieldset key={key}>
                    <legend>
                      {String(field.title ?? key)}
                      {required.includes(key) ? " · required" : ""}
                      {multiple ? " · choose any" : ""}
                    </legend>
                    {field.description != null && (
                      <p>{String(field.description)}</p>
                    )}
                    {field.type === "boolean" ? (
                      <label>
                        <input
                          type="checkbox"
                          checked={elicitation[key] === true}
                          onChange={(event) =>
                            setElicitation((current) => ({
                              ...current,
                              [key]: event.target.checked,
                            }))
                          }
                        />{" "}
                        Yes
                      </label>
                    ) : options.length && multiple ? (
                      <div className="provider-question-options">
                        {options.map((option) => (
                          <button
                            type="button"
                            key={option}
                            aria-pressed={selected.includes(option)}
                            onClick={() =>
                              setElicitation((current) => ({
                                ...current,
                                [key]: selected.includes(option)
                                  ? selected.filter((item) => item !== option)
                                  : [...selected, option],
                              }))
                            }
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : options.length ? (
                      <select
                        value={String(elicitation[key] ?? "")}
                        onChange={(event) =>
                          setElicitation((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Choose…</option>
                        {options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          field.type === "number" || field.type === "integer"
                            ? "number"
                            : field.format === "password" ||
                                field.writeOnly === true
                              ? "password"
                              : "text"
                        }
                        autoComplete="off"
                        value={String(elicitation[key] ?? "")}
                        onChange={(event) =>
                          setElicitation((current) => ({
                            ...current,
                            [key]:
                              field.type === "number" ||
                              field.type === "integer"
                                ? Number(event.target.value)
                                : event.target.value,
                          }))
                        }
                      />
                    )}
                  </fieldset>
                );
              })}
            </div>
          )}
        </div>
        <div className="automation-confirmation-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void onDecision("declined")}
          >
            Decline
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() =>
              void onDecision("accepted", {
                content: mode === "url" ? null : elicitation,
              })
            }
          >
            {mode === "url" ? "I finished the browser step" : "Submit securely"}
          </button>
        </div>
      </section>
    );
  }
  if (request.kind !== "question") {
    const input =
        request.detail.input && typeof request.detail.input === "object"
          ? (request.detail.input as Record<string, unknown>)
          : request.detail,
      filePath = [input.file_path, input.path, request.detail.grantRoot].find(
        (item) => typeof item === "string",
      ) as string | undefined,
      command = [request.detail.command, input.command].find(
        (item) => typeof item === "string",
      ) as string | undefined,
      payload = [input.content, input.patch, request.detail.patch].find(
        (item) => typeof item === "string",
      ) as string | undefined,
      fullDetail = JSON.stringify(request.detail, null, 2),
      operation =
        request.kind === "file_change"
          ? "File change"
          : request.kind === "command"
            ? "Shell command"
            : request.kind.replace("_", " ");
    return (
      <section
        className="automation-confirmation provider-request"
        role="group"
        aria-labelledby={`provider-request-${request.id}`}
      >
        <div className="provider-request-summary">
          <small>
            {request.provider} · {operation} · waiting
          </small>
          <strong id={`provider-request-${request.id}`}>{request.title}</strong>
          {filePath && (
            <p>
              <b>Path</b>
              <code>{filePath}</code>
            </p>
          )}
          {command && (
            <p>
              <b>Command</b>
              <code>
                {command.length > 600 ? `${command.slice(0, 600)}…` : command}
              </code>
            </p>
          )}
          {payload && (
            <p>
              <b>Payload</b>
              <span>
                {new TextEncoder().encode(payload).byteLength.toLocaleString()}{" "}
                bytes
              </span>
            </p>
          )}
          <details>
            <summary>Review full request details</summary>
            <pre>{fullDetail}</pre>
          </details>
        </div>
        <div className="automation-confirmation-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void onDecision("declined")}
          >
            Decline
          </button>
          <button type="button" onClick={() => void onDecision("accepted")}>
            Allow once
          </button>
          <button
            type="button"
            onClick={() => void onDecision("accepted_session")}
          >
            Allow for session
          </button>
        </div>
      </section>
    );
  }
  const ready =
    questions.length > 0 &&
    questions.every((question) => {
      const answer = answers[String(question.id)];
      return Array.isArray(answer)
        ? answer.length > 0
        : Boolean(answer?.trim());
    });
  return (
    <section
      className="automation-confirmation provider-request provider-question-request"
      role="group"
      aria-labelledby={`provider-request-${request.id}`}
    >
      <div>
        <small>{request.provider} · question · waiting</small>
        <strong id={`provider-request-${request.id}`}>{request.title}</strong>
        <div className="provider-question-list">
          {questions.map((question, index) => {
            const id = String(question.id ?? `question-${index}`),
              options = Array.isArray(question.options)
                ? question.options.map((option) =>
                    option && typeof option === "object"
                      ? (option as Record<string, unknown>)
                      : { label: String(option) },
                  )
                : [],
              allowInput = question.isOther === true || options.length === 0,
              multiple = question.multiSelect === true,
              selected = Array.isArray(answers[id])
                ? (answers[id] as string[])
                : typeof answers[id] === "string"
                  ? [answers[id] as string]
                  : [];
            return (
              <fieldset key={id}>
                <legend>
                  {String(question.header ?? `Question ${index + 1}`)}
                  {multiple ? " · choose any" : ""}
                </legend>
                <p>{String(question.question ?? "Choose an answer")}</p>
                {options.length > 0 && (
                  <div className="provider-question-options">
                    {options.map((option, optionIndex) => {
                      const label = String(
                        option.label ?? `Option ${optionIndex + 1}`,
                      );
                      return (
                        <button
                          type="button"
                          aria-pressed={selected.includes(label)}
                          key={`${id}-${label}`}
                          onClick={() =>
                            setAnswers((current) => ({
                              ...current,
                              [id]: multiple
                                ? selected.includes(label)
                                  ? selected.filter((item) => item !== label)
                                  : [...selected, label]
                                : label,
                            }))
                          }
                        >
                          <b>{label}</b>
                          {option.description != null && (
                            <span>{String(option.description)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {allowInput && (
                  <label>
                    <span>
                      {question.isSecret === true
                        ? "Private answer"
                        : "Your answer"}
                    </span>
                    <input
                      type={question.isSecret === true ? "password" : "text"}
                      autoComplete="off"
                      value={
                        typeof answers[id] === "string"
                          ? (answers[id] as string)
                          : ""
                      }
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
              </fieldset>
            );
          })}
        </div>
      </div>
      <div className="automation-confirmation-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => void onDecision("declined")}
        >
          Decline
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            void onDecision("accepted", {
              answers: Object.fromEntries(
                Object.entries(answers).map(([id, answer]) => [
                  id,
                  Array.isArray(answer) ? answer : [answer],
                ]),
              ),
            })
          }
        >
          Submit answers
        </button>
      </div>
    </section>
  );
}

export function App() {
  const [appearance, setAppearance] =
      useState<AppearancePreference>(initialAppearance),
    [systemDark, setSystemDark] = useState(appearanceMediaQuery.matches);
  const platform = window.waypoint.platform,
    shortcutModifier = primaryShortcutLabel(platform),
    knowledgeIcon = knowledgeShortcutIcon(platform);
  const [workspace, setWorkspace] = useState<WorkspaceSummary>(),
    [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [chats, setChats] = useState<Chat[]>([]),
    [selectedChatId, setSelectedChatId] = useState<string>(),
    [documents, setDocuments] = useState<Document[]>([]),
    [memories, setMemories] = useState<Memory[]>([]),
    [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]),
    [commitments, setCommitments] = useState<Commitment[]>([]),
    [activity, setActivity] = useState<ActivityTimelineItem[]>([]);
  const [profiles, setProfiles] = useState<
      Awaited<ReturnType<Window["waypoint"]["listSecurityProfiles"]>>
    >([]),
    [providerSessions, setProviderSessions] = useState<
      Awaited<ReturnType<Window["waypoint"]["listProviderSessions"]>>
    >([]),
    [providerRequests, setProviderRequests] = useState<
      Awaited<ReturnType<Window["waypoint"]["listProviderRequests"]>>
    >([]),
    [runs, setRuns] = useState<Array<Record<string, unknown>>>([]),
    [capabilities, setCapabilities] = useState<
      Awaited<ReturnType<Window["waypoint"]["cliCapabilities"]>>
    >([]),
    [cliModels, setCliModels] = useState<CliModelCatalog>([]),
    [providerRefreshBusy, setProviderRefreshBusy] = useState(false),
    [chatModels, setChatModels] = useState<
      Record<"codex" | "claude" | "grok", string>
    >({
      codex: "",
      claude: "",
      grok: "",
    }),
    [chatThinking, setChatThinking] = useState({
      ...EMPTY_THINKING_PREFERENCES,
    });
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]),
    [attachmentBusy, setAttachmentBusy] = useState(false),
    [attachmentViewer, setAttachmentViewer] = useState<AttachmentViewer>(),
    [chatCli, setChatCli] = useState<
      "codex" | "claude" | "grok" | "openrouter"
    >("codex"),
    [selectedProfileId, setSelectedProfileId] = useState("");
  const attachmentContextRef = useRef<{
      workspaceId?: string;
      chatId?: string;
    }>({}),
    pasteAttemptRef = useRef(0),
    attachmentOperationsRef = useRef(0),
    viewerReturnFocusRef = useRef<HTMLElement | null>(null);
  const [documentIndexes, setDocumentIndexes] = useState<
      Record<
        string,
        Awaited<ReturnType<Window["waypoint"]["documentIndexStatus"]>>
      >
    >({}),
    [documentImportBusy, setDocumentImportBusy] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(),
    [mainTabs, setMainTabs] = useState<MainTab[]>([]),
    [activeMainTabId, setActiveMainTabId] = useState<string>(),
    [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number }>(),
    [screenCaptureOpen, setScreenCaptureOpen] = useState(false),
    [sidebarOpen, setSidebarOpen] = useState(false),
    [historyQuery, setHistoryQuery] = useState(""),
    [historySort, setHistorySort] = useState<HistorySort>("recent"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [diagnostics, setDiagnostics] = useState<DiagnosticsReport>(),
    [checking, setChecking] = useState(false),
    [syncStatus, setSyncStatus] = useState<SanitizedSyncStatus>();
  const tabsWorkspaceRef = useRef<string | undefined>(undefined),
    providerRefreshTaskRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (!workspace || !profiles.length) return;
    let active = true;
    const stored = localStorage.getItem(
      profilePreferenceKey(workspace.id, selectedChatId, chatCli),
    );
    if (stored && profiles.some((item) => item.id === stored))
      queueMicrotask(() => {
        if (active) setSelectedProfileId(stored);
      });
    return () => {
      active = false;
    };
  }, [workspace, selectedChatId, chatCli, profiles]);

  async function authorizeSecurityProfile(profileId: string) {
    if (!workspace) return false;
    const next = profiles.find((item) => item.id === profileId);
    if (!next) return false;
    if (
      next.approval === "never" &&
      localStorage.getItem(`waypoint:bypass-warning:v1:${workspace.id}`) !==
        "accepted"
    ) {
      const accepted = await confirmModal({
        title: "Enable Bypass permissions?",
        message:
          "This mode gives the selected provider no-prompt engineering authority. On Windows, shell and PowerShell commands are not sandbox-contained and may affect files, processes, accounts, or external systems beyond the selected repository. Waypoint will keep audit history and Stop/Cancel, but it will not ask before each operation.",
        okLabel: "Enable bypass",
        cancelLabel: "Keep approvals",
        danger: true,
      });
      if (!accepted) return false;
      localStorage.setItem(
        `waypoint:bypass-warning:v1:${workspace.id}`,
        "accepted",
      );
    }
    return true;
  }
  async function selectSecurityProfile(profileId: string) {
    if (!workspace || !(await authorizeSecurityProfile(profileId))) return;
    localStorage.setItem(
      profilePreferenceKey(workspace.id, selectedChatId, chatCli),
      profileId,
    );
    setSelectedProfileId(profileId);
  }

  async function refreshCliProviders(announce = false) {
    if (providerRefreshTaskRef.current) {
      await providerRefreshTaskRef.current;
      if (announce)
        setNotice("Provider installation and sign-in status refreshed.");
      return;
    }
    setProviderRefreshBusy(true);
    const task = Promise.all([
      window.waypoint.cliCapabilities(),
      window.waypoint.cliModelCatalog(),
    ]).then(([nextCapabilities, nextModels]) => {
      setCapabilities(nextCapabilities);
      setCliModels(nextModels);
    });
    providerRefreshTaskRef.current = task;
    try {
      await task;
      if (announce)
        setNotice("Provider installation and sign-in status refreshed.");
    } finally {
      if (providerRefreshTaskRef.current === task) {
        providerRefreshTaskRef.current = null;
        setProviderRefreshBusy(false);
      }
    }
  }
  const [desktopSync, setDesktopSync] =
      useState<Awaited<ReturnType<Window["waypoint"]["desktopSyncStatus"]>>>(),
    [syncDevices, setSyncDevices] = useState<
      Awaited<ReturnType<Window["waypoint"]["syncDevices"]>>
    >([]),
    [pendingPeers, setPendingPeers] = useState<
      Awaited<ReturnType<Window["waypoint"]["pendingSyncEnrollments"]>>
    >([]),
    [bootstrapBundle, setBootstrapBundle] = useState(""),
    [syncInvitation, setSyncInvitation] = useState<{
      token: string;
      expiresAt: string;
    }>(),
    [inviteBusy, setInviteBusy] = useState(false);
  const [deviceControl, setDeviceControl] =
    useState<Awaited<ReturnType<Window["waypoint"]["deviceControlStatus"]>>>();
  const [briefing, setBriefing] = useState<Briefing>();
  const [ruleSuggestions, setRuleSuggestions] = useState<RuleSuggestion[]>([]),
    [learnedRules, setLearnedRules] = useState<LearnedRule[]>([]),
    [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph>({
      nodes: [],
      edges: [],
    });
  const [activityQuery, setActivityQuery] = useState(""),
    [activityFamilyFilter, setActivityFamilyFilter] = useState<
      ActivityFamily | "all"
    >("all"),
    [activityKnowledgeTarget, setActivityKnowledgeTarget] = useState<string>();
  const [activityCapture, setActivityCapture] =
      useState<ActivityCaptureStatus>(),
    [manualCaptureSettings, setManualCaptureSettings] =
      useState<
        Awaited<ReturnType<Window["waypoint"]["screenCaptureSettings"]>>
      >(),
    [manualCaptureReadiness, setManualCaptureReadiness] =
      useState<
        Awaited<ReturnType<Window["waypoint"]["screenCaptureReadiness"]>>
      >(),
    [capturePermissionError, setCapturePermissionError] = useState(""),
    [activitySnapshots, setActivitySnapshots] = useState<ActivitySnapshot[]>(
      [],
    ),
    [activitySnapshotQuery, setActivitySnapshotQuery] = useState(""),
    [activityExclusions, setActivityExclusions] = useState(""),
    [activityPreview, setActivityPreview] = useState<{
      id: string;
      url: string;
    }>();
  const [reflectionRuns, setReflectionRuns] = useState<
      Awaited<ReturnType<Window["waypoint"]["reflectionRuns"]>>
    >([]),
    [selectedReflectionRunId, setSelectedReflectionRunId] = useState<string>(),
    [reflectionProposals, setReflectionProposals] = useState<
      Awaited<ReturnType<Window["waypoint"]["reflectionProposals"]>>
    >([]),
    [reflectionSources, setReflectionSources] = useState<string[]>([]),
    [reflectionProvider, setReflectionProvider] = useState<
      "codex" | "claude" | "grok"
    >("codex"),
    [reflectionActive, setReflectionActive] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]),
    [meetingConsent, setMeetingConsent] = useState(false),
    [recordingMeetingId, setRecordingMeetingId] = useState<string>(),
    [recordingSeconds, setRecordingSeconds] = useState(0),
    [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>(
      {},
    ),
    [transcriptionCapability, setTranscriptionCapability] =
      useState<TranscriptionCapability>(),
    [meetingPlayback, setMeetingPlayback] = useState<{
      meetingId: string;
      url: string;
      mediaType: string;
    }>(),
    [meetingTranscriptionRun, setMeetingTranscriptionRun] = useState<{
      runId: string;
      meetingId: string;
      completed: number;
      total?: number;
      phase: "preparing" | "transcribing";
    }>();
  const [webhookChannels, setWebhookChannels] = useState<WebhookChannels>(),
    [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]),
    [automationProposals, setAutomationProposals] = useState<
      AutomationProposal[]
    >([]),
    [automationRuntime, setAutomationRuntime] = useState<AutomationRuntime>({
      rules: [],
      runs: [],
    });
  const [toolSettings, setToolSettings] = useState<ToolSettings>(),
    [toolReceipts, setToolReceipts] = useState<ToolReceipt[]>([]),
    [toolFailures, setToolFailures] = useState<ToolFailure[]>([]),
    [toolCapabilities, setToolCapabilities] = useState<ToolCapabilities>(),
    [denyDraft, setDenyDraft] = useState(""),
    [webSearchKey, setWebSearchKeyDraft] = useState("");
  const [installedBrowsers, setInstalledBrowsers] = useState<
    Awaited<ReturnType<Window["waypoint"]["browserDiscovery"]>>
  >([]);
  const [selectedBrowserId, setSelectedBrowserId] = useState("brave"),
    [selectedBrowserProfile, setSelectedBrowserProfile] = useState("");
  const [browserActivity, setBrowserActivity] = useState<
      Array<{
        runId: string;
        sequence: number;
        type: string;
        summary: string;
        output?: string;
        createdAt: string;
      }>
    >([]),
    [activeBrowserRun, setActiveBrowserRun] = useState<string>();
  const [inAppBrowserState, setInAppBrowserState] =
      useState<Awaited<ReturnType<Window["waypoint"]["inAppBrowserStatus"]>>>(),
    [browserAddress, setBrowserAddress] = useState("https://example.com");
  const [rollupSettings, setRollupSettings] = useState<RollupSettings>(),
    [rollupPreview, setRollupPreview] =
      useState<
        Awaited<ReturnType<Window["waypoint"]["composeCrossWorkspaceRollup"]>>
      >();
  const [openRouter, setOpenRouter] = useState<OpenRouterStatus>(),
    [openRouterKey, setOpenRouterKeyDraft] = useState(""),
    [openRouterSettingsDraft, setOpenRouterSettingsDraft] =
      useState<OpenRouterStatus["settings"]>(),
    [openRouterThinkingDraft, setOpenRouterThinkingDraft] =
      useState<OpenRouterThinkingDraft>({
        openrouterStrategic: "",
        openrouterEveryday: "",
        openrouterAttachment: "",
      });
  const [workspaceDialog, setWorkspaceDialog] = useState<"create" | "delete">(),
    [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [voiceCapability, setVoiceCapability] = useState<VoiceCapability>(),
    [voiceEngineStatus, setVoiceEngineStatus] = useState<VoiceEngineStatus>(),
    [voiceEngine, setVoiceEngine] = useState<
      "fast_local" | "full_duplex_experimental"
    >("fast_local"),
    [voiceSessionActive, setVoiceSessionActive] = useState(false),
    [voiceState, setVoiceState] = useState<VoiceState>("off"),
    [voiceMode, setVoiceMode] = useState<VoiceMode>("push_to_talk"),
    [voiceDevice, setVoiceDevice] = useState(""),
    [voiceDevices, setVoiceDevices] = useState<MediaDeviceInfo[]>([]),
    [voicePartial, setVoicePartial] = useState("");
  const refreshGate = useRef(new RefreshGate()),
    settingsOpenRef = useRef(false),
    openRouterDraftGenerationRef = useRef(0),
    composerRef = useRef<HTMLTextAreaElement>(null),
    transcriptRef = useRef<HTMLElement>(null),
    transcriptFollowingRef = useRef(true),
    overlayRef = useRef<HTMLElement>(null),
    previousFocusRef = useRef<HTMLElement | null>(null),
    activeWorkspaceRef = useRef<string | undefined>(undefined);
  activeWorkspaceRef.current = workspace?.id;
  const browserTerminalRunsRef = useRef(new Set<string>());
  const workspaceDialogRef = useRef<HTMLElement>(null),
    workspaceDialogOpenerRef = useRef<HTMLElement | null>(null);
  const inAppBrowserSlotRef = useRef<HTMLDivElement>(null);
  const voiceCaptureRef = useRef(new BrowserPcmCapture()),
    voiceMonitorRef = useRef(new BrowserSpeechMonitor()),
    voicePlayerRef = useRef(
      new BrowserVoicePlayer(
        undefined,
        (scope) =>
          void window.waypoint.voicePlaybackComplete(
            scope.workspaceId,
            scope.chatId,
            scope.turnId,
          ),
        (scope) =>
          void window.waypoint.voicePlaybackStopped(
            scope.workspaceId,
            scope.chatId,
            scope.turnId,
          ),
      ),
    ),
    voiceTurnRef = useRef(0),
    voiceSubmissionRef = useRef<number | undefined>(undefined),
    voiceRunRef = useRef<
      | {
          turn: number;
          workspaceId?: string;
          chatId: string;
          sourceMessageId?: string;
          runId?: string;
          spoken?: boolean;
        }
      | undefined
    >(undefined),
    voiceStateRef = useRef<VoiceState>("off"),
    voicePressReleasedRef = useRef(false),
    voiceCaptureTargetRef = useRef<
      { workspaceId: string; chatId: string } | undefined
    >(undefined),
    voiceScopeRef = useRef<{ workspaceId?: string; chatId?: string }>({});
  const meetingTranscriptionGenerationRef = useRef(0),
    meetingRecorderRef = useRef<MediaRecorder | undefined>(undefined),
    meetingStreamRef = useRef<MediaStream | undefined>(undefined),
    meetingChunksRef = useRef<Blob[]>([]),
    meetingTimerRef = useRef<number | undefined>(undefined),
    meetingIdRef = useRef<string | undefined>(undefined),
    meetingWorkspaceIdRef = useRef<string | undefined>(undefined),
    meetingStoppingRef = useRef(false),
    meetingBytesRef = useRef(0);

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason));
  }
  function changeAppearance(next: AppearancePreference) {
    setAppearance(next);
    try {
      persistAppearance(window.localStorage, next);
    } catch {
      setNotice(
        "Appearance changed for this session. Local preference storage is unavailable.",
      );
    }
  }
  useEffect(() => {
    if (!error && !notice) return;
    const timer = window.setTimeout(
      () => {
        setError("");
        setNotice("");
      },
      error ? 10_000 : 6_000,
    );
    return () => window.clearTimeout(timer);
  }, [error, notice]);
  useEffect(() => {
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    appearanceMediaQuery.addEventListener("change", update);
    return () => appearanceMediaQuery.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    applyAppearance(document.documentElement, appearance, systemDark);
  }, [appearance, systemDark]);
  async function selectReflectionRun(runId: string) {
    if (!workspace) return;
    setSelectedReflectionRunId(runId);
    setReflectionProposals(
      await window.waypoint.reflectionProposals(workspace.id, runId),
    );
  }
  async function openReflection() {
    if (!workspace) return;
    setSidebarOpen(false);
    openViewTab("reflection");
    const runs = await window.waypoint.reflectionRuns(workspace.id);
    setReflectionRuns(runs);
    setReflectionSources(
      [
        ...memories.map((item) => item.id),
        ...documents.map((item) => item.id),
      ].slice(0, 50),
    );
    const selected = runs[0];
    setSelectedReflectionRunId(selected?.id);
    setReflectionProposals(
      selected
        ? await window.waypoint.reflectionProposals(workspace.id, selected.id)
        : [],
    );
  }
  async function startReflection() {
    if (!workspace) return;
    setReflectionActive(true);
    setNotice(`${reflectionProvider} is reviewing the selected local sources…`);
    try {
      const result = await window.waypoint.startReflection(
          workspace.id,
          reflectionSources,
          reflectionProvider,
        ),
        runs = await window.waypoint.reflectionRuns(workspace.id);
      setReflectionRuns(runs);
      setSelectedReflectionRunId(result.runId);
      setReflectionProposals(
        await window.waypoint.reflectionProposals(workspace.id, result.runId),
      );
      setNotice(
        `${result.proposalCount} reviewable reflection proposal${result.proposalCount === 1 ? "" : "s"} created by the signed-in ${reflectionProvider} CLI. Sources were not overwritten.`,
      );
    } finally {
      setReflectionActive(false);
      setReflectionRuns(await window.waypoint.reflectionRuns(workspace.id));
    }
  }
  async function resolveReflection(
    item: (typeof reflectionProposals)[number],
    action: "accept" | "edit" | "reject" | "rollback",
  ) {
    if (!workspace) return;
    let body: string | undefined;
    if (action === "edit") {
      body =
        (await promptModal({
          title: "Edit proposed revision",
          message: "Edit the proposed revision before accepting.",
          defaultValue: item.proposedBody,
          multiline: true,
          okLabel: "Accept revision",
        })) ?? undefined;
      if (body === undefined) return;
    }
    await window.waypoint.resolveReflection(
      workspace.id,
      item.id,
      action,
      body,
    );
    if (selectedReflectionRunId)
      await selectReflectionRun(selectedReflectionRunId);
    setReflectionRuns(await window.waypoint.reflectionRuns(workspace.id));
    await refresh();
    setNotice(
      `Reflection proposal ${action === "edit" ? "edited and accepted" : action}.`,
    );
  }
  async function loadToolGateway() {
    if (!workspace) return;
    const [settings, receipts, failures, caps] = await Promise.all([
      window.waypoint.toolGatewaySettings(workspace.id),
      window.waypoint.toolGatewayReceipts(workspace.id),
      window.waypoint.toolFailures(workspace.id),
      window.waypoint.toolGatewayCapabilities(),
    ]);
    setToolSettings(settings);
    setDenyDraft(settings.denyPatterns.join("\n"));
    setToolReceipts(receipts);
    setToolFailures(failures);
    setToolCapabilities(caps);
  }
  async function updateWebTools(value: {
    webFetchEnabled: boolean;
    webSearchEnabled: boolean;
  }) {
    if (!workspace) return;
    await window.waypoint.updateWebTools(workspace.id, value);
    await loadToolGateway();
    setNotice("Web tool policy saved for this workspace.");
  }
  async function saveToolGateway(overrides: Partial<ToolSettings> = {}) {
    if (!workspace || !toolSettings) return;
    const next = {
      stopped: overrides.stopped ?? toolSettings.stopped,
      denyPatterns:
        overrides.denyPatterns ??
        denyDraft
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      suppressCommit: overrides.suppressCommit ?? toolSettings.suppressCommit,
      suppressPush: overrides.suppressPush ?? toolSettings.suppressPush,
      browserProfileMode:
        overrides.browserProfileMode ?? toolSettings.browserProfileMode,
      browserProfileName:
        overrides.browserProfileName ?? toolSettings.browserProfileName,
      browserAllowedDomains:
        overrides.browserAllowedDomains ?? toolSettings.browserAllowedDomains,
    };
    setToolSettings(
      await window.waypoint.updateToolGatewaySettings(workspace.id, next),
    );
    if (next.stopped) await stopVoiceMode();
    await loadToolGateway();
    setNotice(
      next.stopped
        ? "Tool Gateway and active voice stopped for this workspace."
        : "Tool Gateway policy saved.",
    );
  }
  async function importBrowserProfile() {
    if (!workspace || !selectedBrowserProfile)
      throw new Error("Choose an installed Chromium profile first.");
    const result = await window.waypoint.importBrowserProfile(
      workspace.id,
      selectedBrowserId,
      selectedBrowserProfile,
    );
    setToolSettings(result.settings);
    setNotice(
      `${result.profile.browserId} ${result.profile.profileId} imported as a private ${(result.profile.bytes / 1024 / 1024).toFixed(1)} MiB snapshot. The original profile is untouched.`,
    );
    await loadToolGateway();
  }
  async function openInAppBrowser() {
    if (!workspace || !inAppBrowserSlotRef.current)
      throw new Error("The browser surface is not ready");
    const rect = inAppBrowserSlotRef.current.getBoundingClientRect(),
      state = await window.waypoint.openInAppBrowser(
        workspace.id,
        browserAddress,
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      );
    setInAppBrowserState(state);
  }
  async function stopAllBrowserTools() {
    if (!workspace) return;
    const current =
      toolSettings ?? (await window.waypoint.toolGatewaySettings(workspace.id));
    await window.waypoint.updateToolGatewaySettings(workspace.id, {
      ...current,
      stopped: true,
    });
    await window.waypoint.closeInAppBrowser(workspace.id);
    setActiveBrowserRun(undefined);
    setNotice(
      "Global stop applied to Tool Gateway and browser activity. Resume it explicitly in Settings.",
    );
  }
  async function saveRollups(next: RollupSettings) {
    if (!workspace) return;
    setRollupSettings(
      await window.waypoint.updateCrossWorkspaceRollupSettings(workspace.id, {
        standingEnabled: next.standingEnabled,
        grants: next.grants.map(({ sourceWorkspaceId, family, enabled }) => ({
          sourceWorkspaceId,
          family,
          enabled,
        })),
      }),
    );
    setNotice(
      "Cross-workspace summary grants saved. Raw source bodies remain isolated.",
    );
  }
  async function refreshOpenRouter() {
    const status = await window.waypoint.openRouterStatus();
    setOpenRouter(status);
    openRouterDraftGenerationRef.current += 1;
    setOpenRouterSettingsDraft(status.settings);
  }
  function editOpenRouterSettingsDraft(
    next: OpenRouterStatus["settings"],
  ) {
    openRouterDraftGenerationRef.current += 1;
    setOpenRouterSettingsDraft(next);
  }
  function editOpenRouterThinkingDraft(
    update: (current: OpenRouterThinkingDraft) => OpenRouterThinkingDraft,
  ) {
    openRouterDraftGenerationRef.current += 1;
    setOpenRouterThinkingDraft(update);
  }
  async function storeOpenRouterKey() {
    if (!openRouterKey) return;
    await window.waypoint.setOpenRouterKey(openRouterKey);
    setOpenRouterKeyDraft("");
    await refreshOpenRouter();
    setNotice(
      "OpenRouter key stored in OS-protected storage. Enable hosted requests with the single activation control when ready.",
    );
  }
  async function saveOpenRouterSettings() {
    if (!openRouterSettingsDraft || !workspace) return;
    const result = await window.waypoint.updateOpenRouterRouting(
      workspace.id,
      openRouterSettingsDraft,
      openRouterThinkingDraft,
    );
    setChatThinking(result.thinking);
    setOpenRouterThinkingDraft({
      openrouterStrategic: result.thinking.openrouterStrategic,
      openrouterEveryday: result.thinking.openrouterEveryday,
      openrouterAttachment: result.thinking.openrouterAttachment,
    });
    openRouterDraftGenerationRef.current += 1;
    setOpenRouterSettingsDraft(result.settings);
    await refreshOpenRouter();
    setNotice(
      "OpenRouter preferences saved. Hosted requests occur only when the provider and explicit hosted-request switch are enabled.",
    );
  }
  async function toggleOpenRouterActivation() {
    if (!openRouter) return;
    const active =
        openRouter.settings.enabled && openRouter.settings.liveRequestsEnabled,
      next = nextOpenRouterActivation(
        openRouter.settings,
        openRouter.keyConfigured,
      );
    await window.waypoint.updateOpenRouterSettings(next);
    await refreshOpenRouter();
    setNotice(
      active
        ? "OpenRouter hosted requests disabled."
        : "OpenRouter hosted requests enabled with protected key, selected models, and existing spending caps. No test request was sent.",
    );
  }
  async function changeComposerModel(value: string) {
    if (chatCli === "openrouter") {
      if (!openRouter) return;
      const imageRoute = attachments.some(
          (item) =>
            item.ownerId === selectedChatId &&
            item.mediaType.startsWith("image/"),
        ),
        next = {
          ...openRouter.settings,
          ...(imageRoute
            ? { attachmentModel: value }
            : { everydayModel: value }),
        };
      setOpenRouter({ ...openRouter, settings: next });
      await window.waypoint.updateOpenRouterSettings(next);
      const lane = imageRoute
          ? "openrouterAttachment"
          : "openrouterEveryday",
        supported = openRouterModelThinking(value)?.supported ?? [];
      if (chatThinking[lane] && !supported.includes(chatThinking[lane]))
        await changeThinking(lane, "");
      await refreshOpenRouter();
      return;
    }
    await changeSubscriptionModel(chatCli, value);
  }
  async function changeSubscriptionModel(
    provider: "codex" | "claude" | "grok",
    value: string,
  ) {
    if (!workspace) return;
    setChatModels(
      await window.waypoint.setChatModelPreference(
        workspace.id,
        provider,
        value,
      ),
    );
    const supported =
      cliModels
        .find((item) => item.provider === provider)
        ?.models.find((item) => item.id === value)?.thinking?.supported ?? [];
    if (chatThinking[provider] && !supported.includes(chatThinking[provider]))
      await changeThinking(provider, "");
  }
  async function changeThinking(
    lane: ThinkingLane,
    value: ThinkingEffort | "",
  ) {
    if (!workspace) return;
    setChatThinking(
      await window.waypoint.setChatThinkingPreference(
        workspace.id,
        lane,
        value,
      ),
    );
  }
  async function openAutomations() {
    if (!workspace) return;
    const nextSync = await window.waypoint.desktopSyncStatus(workspace.id);
    if (nextSync.configured) {
      const [channels, events] = await Promise.all([
        window.waypoint.webhookChannels(workspace.id),
        window.waypoint.listWebhookEvents(workspace.id),
      ]);
      setWebhookChannels(channels);
      setWebhookEvents(events);
    } else {
      setWebhookChannels(undefined);
      setWebhookEvents([]);
    }
    const [proposals, runtime] = await Promise.all([
      window.waypoint.automationProposals(workspace.id),
      window.waypoint.automationRulesAndRuns(workspace.id),
    ]);
    setAutomationProposals(proposals);
    setAutomationRuntime(runtime);
    setSidebarOpen(false);
    openViewTab("automations");
  }
  async function createWebhookChannel() {
    if (!workspace) return;
    const connectors = await window.waypoint.webhookConnectors(),
      connectorId = (
        await promptModal({
          title: "Webhook connector",
          message:
            "Enter generic, github, or azure_devops. Stripe and Resend require signing-secret import that is not available yet.",
          defaultValue: "generic",
          okLabel: "Continue",
        })
      )
        ?.trim()
        .toLowerCase() as (typeof connectors)[number]["id"] | undefined;
    if (!connectorId) return;
    const connector = connectors.find((item) => item.id === connectorId);
    if (!connector || connectorId === "stripe" || connectorId === "resend")
      throw new Error(
        "Choose generic, github, or azure_devops. Stripe and Resend setup is unavailable until provider signing-secret import is implemented.",
      );
    const label = (
      await promptModal({
        title: "Inbound webhook channel name",
        defaultValue: "Private inbound",
        okLabel: "Create channel",
      })
    )?.trim();
    if (!label) return;
    const result = await window.waypoint.createWebhookChannel(
        workspace.id,
        label,
        connectorId,
      ),
      configuration = {
        connectorId,
        endpoint: result.endpoint,
        channelId: result.channelId,
        secretVersion: result.secretVersion,
        authentication:
          connectorId === "azure_devops"
            ? { type: "basic", username: "waypoint", password: result.secret }
            : connectorId === "github"
              ? { type: "github-hmac-sha256", secret: result.secret }
              : connectorId === "generic"
                ? { type: "waypoint-hmac-sha256", signingSecret: result.secret }
                : {
                    type: result.authMode,
                    temporaryRelaySecret: result.secret,
                    requiresProviderSigningSecretImport: true,
                  },
        recipientPublicKey: result.recipientPublicKey,
        reachability:
          result.transportMode === "hosted-relay"
            ? "public trusted relay"
            : "local network; desktop host must remain running; cloud providers generally cannot reach or trust this endpoint",
        ...(result.transportMode === "desktop-host"
          ? {
              tls: {
                trust: "self-signed-pinned",
                certificatePem: result.certificatePem,
                fingerprintSha256: result.fingerprintSha256,
              },
            }
          : {}),
      };
    await navigator.clipboard.writeText(JSON.stringify(configuration, null, 2));
    setWebhookChannels(await window.waypoint.webhookChannels(workspace.id));
    setNotice(
      "One-time connector configuration copied to the clipboard. Store it in protected provider settings; Waypoint will not show the secret again.",
    );
  }
  async function decideAutomationProposal(
    proposal: AutomationProposal,
    decision: "approve" | "reject",
  ) {
    if (!workspace) return;
    const updated = await window.waypoint.decideAutomationProposal(
      workspace.id,
      proposal.id,
      proposal.proposalDigest,
      decision,
    );
    setAutomationProposals((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
    setAutomationRuntime(
      await window.waypoint.automationRulesAndRuns(workspace.id),
    );
    setNotice(
      decision === "reject"
        ? "Proposal rejected. No external provider change was made."
        : updated.status === "applied"
          ? "The digest-bound connector configuration was applied and its exact approved rule is enabled. You can stop it at any time in Automations."
          : updated.status === "failed"
            ? `The approved connector setup could not be applied: ${String(updated.receipt?.externalMutation.summary ?? "See Automations for the unavailable gate.")}`
            : "Proposal approved. Provisioning is waiting for a public endpoint or required provider configuration.",
    );
  }
  async function setAutomationRuleEnabled(ruleId: string, enabled: boolean) {
    if (!workspace) return;
    await window.waypoint.setAutomationRuleEnabled(
      workspace.id,
      ruleId,
      enabled,
    );
    setAutomationRuntime(
      await window.waypoint.automationRulesAndRuns(workspace.id),
    );
    setNotice(
      enabled
        ? "Webhook automation resumed. New matching authenticated events can start the approved AI route."
        : "Webhook automation stopped. Queued runs were canceled; an already-running AI job must be canceled separately.",
    );
  }
  async function cancelAutomationRun(runId: string) {
    if (!workspace) return;
    await window.waypoint.cancelAutomationRun(workspace.id, runId);
    setAutomationRuntime(
      await window.waypoint.automationRulesAndRuns(workspace.id),
    );
    setNotice("Automation cancellation requested.");
  }
  async function rotateWebhookChannel(channelId: string) {
    if (
      !workspace ||
      !(await confirmModal({
        title: "Rotate signing secret?",
        message:
          "Rotate this signing secret now? The previous sender configuration will stop immediately.",
        okLabel: "Rotate now",
        danger: true,
      }))
    )
      return;
    const result = await window.waypoint.rotateWebhookChannel(
      workspace.id,
      channelId,
    );
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          channelId,
          secretVersion: result.secretVersion,
          signingSecret: result.secret,
        },
        null,
        2,
      ),
    );
    setWebhookChannels(await window.waypoint.webhookChannels(workspace.id));
    setNotice(
      "Rotated one-time signing configuration copied. Update the sender before retrying.",
    );
  }
  async function refreshWebhookEvents() {
    if (!workspace) return;
    const result = await window.waypoint.fetchWebhookEvents(workspace.id);
    setWebhookEvents(await window.waypoint.listWebhookEvents(workspace.id));
    setNotice(
      `${result.imported} authenticated inbound event${result.imported === 1 ? "" : "s"} fetched into quarantine.${result.rejected ? ` ${result.rejected} invalid encrypted event${result.rejected === 1 ? " was" : "s were"} rejected and acknowledged so later events can continue.` : ""} Only exact enabled rules were evaluated; unmatched events caused no action.`,
    );
  }
  async function deleteWebhookEvent(eventId: string) {
    if (
      !workspace ||
      !(await confirmModal({
        title: "Delete inbound event?",
        message:
          "Permanently delete this unmatched quarantined event? Events linked to queued, running, or completed automation runs are retained as audit evidence and cannot be deleted here.",
        okLabel: "Permanently delete",
        danger: true,
      }))
    )
      return;
    await window.waypoint.deleteWebhookEvent(workspace.id, eventId);
    setWebhookEvents(await window.waypoint.listWebhookEvents(workspace.id));
  }
  async function openMeetings() {
    if (!workspace) return;
    const [nextMeetings, capability] = await Promise.all([
      window.waypoint.listMeetings(workspace.id),
      window.waypoint.meetingTranscriptionCapability(),
    ]);
    setMeetings(nextMeetings);
    setTranscriptDrafts(
      Object.fromEntries(
        nextMeetings.map((item) => [item.id, item.transcript ?? ""]),
      ),
    );
    setTranscriptionCapability(capability);
    setSidebarOpen(false);
    openViewTab("meetings");
  }
  async function startMeeting() {
    if (!workspace || !meetingConsent)
      throw new Error("Acknowledge recording consent for this session first");
    const title = (
      await promptModal({
        title: "Meeting title",
        defaultValue: "Meeting notes",
        okLabel: "Start recording",
      })
    )?.trim();
    if (!title) {
      setMeetingConsent(false);
      return;
    }
    let stream: MediaStream | undefined, meetingId: string | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      meetingId = (
        await window.waypoint.createMeeting(workspace.id, title, true)
      ).meetingId;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
        recorder = new MediaRecorder(stream, { mimeType }),
        track = stream.getAudioTracks()[0];
      if (!track) throw new Error("No microphone audio track was available");
      meetingChunksRef.current = [];
      meetingBytesRef.current = 0;
      meetingStoppingRef.current = false;
      meetingIdRef.current = meetingId;
      meetingWorkspaceIdRef.current = workspace.id;
      meetingStreamRef.current = stream;
      meetingRecorderRef.current = recorder;
      setRecordingMeetingId(meetingId);
      setRecordingSeconds(0);
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        meetingChunksRef.current.push(event.data);
        meetingBytesRef.current += event.data.size;
        if (meetingBytesRef.current > 100 * 1024 * 1024)
          void stopMeeting("size_limit");
      };
      recorder.onerror = () => void stopMeeting("capture_failed");
      track.onended = () => void stopMeeting("device_lost");
      recorder.start(1000);
      meetingTimerRef.current = window.setInterval(
        () =>
          setRecordingSeconds((value) => {
            if (value >= 7199) void stopMeeting();
            return value + 1;
          }),
        1000,
      );
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      if (meetingId)
        await window.waypoint
          .failMeeting(workspace.id, meetingId, "capture_failed")
          .catch(() => undefined);
      meetingRecorderRef.current = undefined;
      meetingStreamRef.current = undefined;
      meetingIdRef.current = undefined;
      meetingWorkspaceIdRef.current = undefined;
      meetingChunksRef.current = [];
      setRecordingMeetingId(undefined);
      setRecordingSeconds(0);
      setMeetingConsent(false);
      throw reason;
    }
  }
  async function stopMeeting(
    failureCode?:
      "device_lost" | "interrupted" | "capture_failed" | "size_limit",
  ) {
    const recorder = meetingRecorderRef.current,
      meetingId = meetingIdRef.current,
      originWorkspaceId = meetingWorkspaceIdRef.current;
    if (
      !recorder ||
      !meetingId ||
      !originWorkspaceId ||
      meetingStoppingRef.current
    )
      return;
    meetingStoppingRef.current = true;
    if (meetingTimerRef.current) window.clearInterval(meetingTimerRef.current);
    if (recorder.state !== "inactive")
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    meetingStreamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    try {
      if (failureCode)
        await window.waypoint.failMeeting(
          originWorkspaceId,
          meetingId,
          failureCode,
        );
      else {
        const blob = new Blob(meetingChunksRef.current, {
            type: recorder.mimeType,
          }),
          audio = new Uint8Array(await blob.arrayBuffer());
        await window.waypoint.finalizeMeeting(
          originWorkspaceId,
          meetingId,
          recorder.mimeType.split(";")[0],
          audio,
        );
      }
    } finally {
      meetingRecorderRef.current = undefined;
      meetingStreamRef.current = undefined;
      meetingIdRef.current = undefined;
      meetingWorkspaceIdRef.current = undefined;
      meetingChunksRef.current = [];
      meetingBytesRef.current = 0;
      meetingStoppingRef.current = false;
      setRecordingMeetingId(undefined);
      setRecordingSeconds(0);
      setMeetingConsent(false);
      if (workspace?.id === originWorkspaceId)
        setMeetings(await window.waypoint.listMeetings(originWorkspaceId));
    }
  }
  async function playMeeting(meetingId: string) {
    if (!workspace) return;
    if (meetingPlayback?.meetingId === meetingId) {
      setMeetingPlayback(undefined);
      return;
    }
    const result = await window.waypoint.meetingPlaybackUrl(
      workspace.id,
      meetingId,
    );
    setMeetingPlayback({ meetingId, ...result });
  }
  async function saveTranscript(meetingId: string, reviewed: boolean) {
    if (!workspace) return;
    await window.waypoint.updateMeetingTranscript(
      workspace.id,
      meetingId,
      transcriptDrafts[meetingId] ?? "",
      reviewed,
    );
    setMeetings(await window.waypoint.listMeetings(workspace.id));
    setNotice(
      reviewed
        ? "Transcript marked reviewed."
        : "Transcript draft saved locally.",
    );
  }
  async function transcribeMeeting(meetingId: string) {
    if (!workspace || meetingTranscriptionRun) return;
    const generation = ++meetingTranscriptionGenerationRef.current,
      origin = workspace.id;
    let runId: string | undefined;
    try {
      const started = await window.waypoint.startMeetingTranscription(
        origin,
        meetingId,
      );
      runId = started.runId;
      setMeetingTranscriptionRun({
        runId,
        meetingId,
        completed: 0,
        phase: "preparing",
      });
      const result = await window.waypoint.transcribeMeetingRecording(
        origin,
        meetingId,
        runId,
      );
      if (
        activeWorkspaceRef.current === origin &&
        meetingTranscriptionGenerationRef.current === generation
      ) {
        setTranscriptDrafts((current) => ({
          ...current,
          [meetingId]: result.transcript,
        }));
        setMeetings(await window.waypoint.listMeetings(origin));
        setNotice(
          `Local draft created with ${result.provider}. Review speakers and text before saving to knowledge.`,
        );
      }
    } catch (reason) {
      if (runId)
        await window.waypoint
          .cancelMeetingTranscription(origin, meetingId, runId)
          .catch(() => undefined);
      if (
        activeWorkspaceRef.current === origin &&
        meetingTranscriptionGenerationRef.current === generation
      )
        showError(reason);
    } finally {
      if (meetingTranscriptionGenerationRef.current === generation)
        setMeetingTranscriptionRun(undefined);
    }
  }
  async function cancelMeetingTranscription() {
    if (!workspace || !meetingTranscriptionRun) return;
    await window.waypoint.cancelMeetingTranscription(
      workspace.id,
      meetingTranscriptionRun.meetingId,
      meetingTranscriptionRun.runId,
    );
    setNotice(
      "Canceling local meeting transcription; the previous transcript remains unchanged.",
    );
  }
  async function saveMeetingMemory(meetingId: string) {
    if (!workspace) return;
    await window.waypoint.saveMeetingMemory(workspace.id, meetingId);
    await refresh();
    setNotice("Reviewed transcript saved to knowledge.");
  }
  async function removeMeeting(meetingId: string) {
    if (
      !workspace ||
      !(await confirmModal({
        title: "Delete meeting recording?",
        message:
          "Permanently delete this local recording, transcript, and source-owned memory?",
        okLabel: "Permanently delete",
        danger: true,
      }))
    )
      return;
    if (meetingTranscriptionRun?.meetingId === meetingId)
      await window.waypoint.cancelMeetingTranscription(
        workspace.id,
        meetingId,
        meetingTranscriptionRun.runId,
      );
    await window.waypoint.deleteMeeting(workspace.id, meetingId);
    setMeetings(await window.waypoint.listMeetings(workspace.id));
  }
  function activateMainTab(tab: MainTab) {
    settingsOpenRef.current = tab.kind === "view" && tab.view === "settings";
    if (settingsOpenRef.current) openRouterDraftGenerationRef.current += 1;
    setMainTabs((current) => addMainTab(current, tab));
    setActiveMainTabId(tab.id);
    setTabMenu(undefined);
    setSidebarOpen(false);
    if (tab.kind === "chat") {
      setSelectedChatId(tab.chatId);
      setDrawer(undefined);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    } else {
      setDrawer(tab.view);
    }
  }
  function openChatTab(chatId: string) {
    activateMainTab(chatTab(chatId));
  }
  function openViewTab(view: WorkspaceView) {
    activateMainTab(viewTab(view));
  }
  function closeTab(targetId: string, action: TabCloseAction) {
    const remaining = closeMainTabs(mainTabs, targetId, action),
      nextId = nextActiveMainTabId(
        mainTabs,
        remaining,
        targetId,
        activeMainTabId,
      ),
      removed = mainTabs.filter(
        (tab) => !remaining.some((candidate) => candidate.id === tab.id),
      ),
      removedRunningChat = removed.some(
        (tab) =>
          tab.kind === "chat" &&
          runs.some(
            (run) =>
              run.chatId === tab.chatId &&
              (run.status === "queued" || run.status === "running"),
          ),
      );
    setMainTabs(remaining);
    setActiveMainTabId(nextId);
    setTabMenu(undefined);
    if (removedRunningChat)
      setNotice(
        "The closed chat tab is still running. Reopen it from Conversations at any time.",
      );
    const next = remaining.find((tab) => tab.id === nextId);
    if (next?.kind === "chat") {
      setSelectedChatId(next.chatId);
      setDrawer(undefined);
    } else if (next?.kind === "view") {
      setDrawer(next.view);
    } else {
      setDrawer(undefined);
    }
  }
  function followActivity(item: ActivityTimelineItem) {
    if (item.objectState !== "available" || !item.targetId || !item.targetKind)
      return;
    if (item.targetKind === "chat") {
      openChatTab(item.targetId);
      return;
    }
    if (item.targetKind === "rule") {
      openViewTab("rules");
      return;
    }
    setActivityKnowledgeTarget(item.targetId);
    openViewTab("knowledge");
  }
  async function refresh(next = workspace) {
    if (!next) return;
    const token = refreshGate.current.begin();
    const [
      nextChats,
      nextDocuments,
      nextMemories,
      nextSuggestions,
      nextCommitments,
      nextActivity,
      nextProfiles,
      nextProviderSessions,
      nextProviderRequests,
      nextRuns,
      nextSync,
      nextDesktop,
      nextChatModels,
      nextChatThinking,
      nextVoice,
    ] = await Promise.all([
      window.waypoint.listChats(next.id),
      window.waypoint.listDocuments(next.id),
      window.waypoint.listMemories(next.id),
      window.waypoint.listMemorySuggestions(next.id),
      window.waypoint.listCommitments(next.id),
      window.waypoint.activity(next.id, { limit: 500 }),
      window.waypoint.listSecurityProfiles(next.id),
      window.waypoint.listProviderSessions(next.id),
      window.waypoint.listProviderRequests(next.id),
      window.waypoint.listExecutions(next.id),
      window.waypoint.syncStatus(next.id),
      window.waypoint.desktopSyncStatus(next.id),
      window.waypoint.chatModelPreferences(next.id),
      window.waypoint.chatThinkingPreferences(next.id),
      window.waypoint.voicePreferences(next.id),
    ]);
    if (!refreshGate.current.isCurrent(token)) return;
    setChats(nextChats);
    if (tabsWorkspaceRef.current !== next.id) {
      const initialChatId = reconcileSelectedChatId(nextChats, undefined),
        initialTabs = initialChatId ? [chatTab(initialChatId)] : [];
      tabsWorkspaceRef.current = next.id;
      setSelectedChatId(initialChatId);
      setMainTabs(initialTabs);
      setActiveMainTabId(initialTabs[0]?.id);
      setDrawer(undefined);
    } else {
      setSelectedChatId((current) =>
        reconcileSelectedChatId(nextChats, current),
      );
    }
    setDocuments(nextDocuments);
    setMemories(nextMemories);
    setSuggestions(nextSuggestions);
    setCommitments(nextCommitments);
    setActivity(nextActivity);
    setProfiles(nextProfiles);
    setProviderSessions(nextProviderSessions);
    setProviderRequests(nextProviderRequests);
    setSelectedProfileId((current) =>
      nextProfiles.some((item) => item.id === current)
        ? current
        : (nextProfiles[0]?.id ?? ""),
    );
    setRuns(nextRuns);
    setNotice((current) =>
      responseNoticeAfterRuns(
        current,
        uniqueChatRuns(
          nextRuns.filter(
            (run) => run.chatId === selectedChatId,
          ) as ExecutionRunView[],
        ),
      ),
    );
    setSyncStatus(nextSync);
    setDesktopSync(nextDesktop);
    setChatModels(nextChatModels);
    setChatThinking(nextChatThinking);
    if (!settingsOpenRef.current)
      setOpenRouterThinkingDraft({
        openrouterStrategic: nextChatThinking.openrouterStrategic,
        openrouterEveryday: nextChatThinking.openrouterEveryday,
        openrouterAttachment: nextChatThinking.openrouterAttachment,
      });
    setVoiceMode(nextVoice.mode);
    setVoiceDevice(nextVoice.microphoneId);
    setVoiceEngine(nextVoice.engine);
    void window.waypoint
      .voiceEngineStatus(next.id)
      .then(setVoiceEngineStatus)
      .catch(() => undefined);
    if (nextDesktop.configured) {
      const [devices, pending, control] = await Promise.all([
        window.waypoint.syncDevices(next.id).catch(() => []),
        window.waypoint.pendingSyncEnrollments(next.id).catch(() => []),
        window.waypoint.deviceControlStatus(next.id),
      ]);
      if (refreshGate.current.isCurrent(token)) {
        setSyncDevices(devices);
        setPendingPeers(pending);
        setDeviceControl(control);
      }
    } else {
      setSyncDevices([]);
      setPendingPeers([]);
      setDeviceControl(undefined);
    }
  }
  async function selectWorkspace(next: WorkspaceSummary) {
    tabsWorkspaceRef.current = undefined;
    setSyncInvitation(undefined);
    setInviteBusy(false);
    setWorkspace(next);
    setSelectedChatId(undefined);
    setDrawer(undefined);
    setMainTabs([]);
    setActiveMainTabId(undefined);
    setTabMenu(undefined);
    await refresh(next);
    const status = await window.waypoint.activityCaptureStatus(next.id);
    setActivityCapture(status);
    setActivityExclusions(status.policy.exclusions.join("\n"));
  }
  // Subscription identity follows visible chat scope.
  useEffect(
    () =>
      window.waypoint.onInAppBrowserState((state) => {
        if (state.workspaceId === workspace?.id) {
          setInAppBrowserState(state);
          if (state.url) setBrowserAddress(state.url);
        }
      }),
    [workspace],
  );
  useEffect(
    () =>
      window.waypoint.onScreenCaptureRequest(() => setScreenCaptureOpen(true)),
    [],
  );
  useEffect(
    () =>
      window.waypoint.onScreenCaptureCompleted((result) => {
        if (result.status === "failed") setError(result.message);
        else if (result.status === "completed") setNotice(result.message);
      }),
    [],
  );
  useEffect(
    () =>
      window.waypoint.onMeetingTranscriptionProgress((event) => {
        if (activeWorkspaceRef.current !== event.workspaceId) return;
        setMeetingTranscriptionRun((current) =>
          current?.runId === event.runId &&
          current.meetingId === event.meetingId
            ? {
                ...current,
                phase: event.phase,
                completed: event.completed,
                total: event.total,
              }
            : current,
        );
      }),
    [],
  );
  useEffect(() => {
    if (!workspace) return;
    let current = true;
    void Promise.all([
      window.waypoint.screenCaptureSettings(workspace.id),
      window.waypoint.screenCaptureReadiness(),
    ])
      .then(([settings, readiness]) => {
        if (!current) return;
        setCapturePermissionError("");
        setManualCaptureSettings(settings);
        setManualCaptureReadiness(readiness);
      })
      .catch((reason) => {
        if (!current) return;
        const message =
          reason instanceof Error ? reason.message : "Capture readiness failed";
        setCapturePermissionError(message);
        showError(reason);
      });
    return () => {
      current = false;
    };
  }, [workspace]);
  useEffect(() => {
    if (drawer !== "browser" || !workspace) return;
    const slot = inAppBrowserSlotRef.current;
    if (!slot) return;
    const workspaceId = workspace.id,
      update = () => {
        const bounds = slot.getBoundingClientRect();
        void window.waypoint.updateInAppBrowserBounds(workspaceId, {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
      },
      observer = new ResizeObserver(update);
    observer.observe(slot);
    window.addEventListener("resize", update);
    void window.waypoint
      .inAppBrowserStatus(workspaceId)
      .then(setInAppBrowserState);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      void window.waypoint.hideInAppBrowser(workspaceId);
    };
  }, [drawer, workspace]);
  useEffect(() => {
    void window.waypoint
      .bootstrap()
      .then(async ({ workspaces: available }) => {
        setWorkspaces(available);
        if (available[0]) await selectWorkspace(available[0]);
      })
      .catch(showError);
    void Promise.resolve()
      .then(() => refreshCliProviders())
      .catch(showError);
    // Initial bootstrap intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!runs.some((run) => run.status === "running")) return;
    const timer = window.setInterval(
      () => void refresh().catch(showError),
      750,
    );
    return () => window.clearInterval(timer);
  });
  useEffect(() => {
    if (!workspace || !selectedChatId) return;
    void window.waypoint
      .listChatAttachments(workspace.id, selectedChatId)
      .then(setAttachments)
      .catch(showError);
  }, [workspace, selectedChatId, chats]);
  useEffect(() => {
    if (!workspace) return;
    void Promise.all([
      window.waypoint.automationProposals(workspace.id),
      window.waypoint.automationRulesAndRuns(workspace.id),
    ])
      .then(([proposals, runtime]) => {
        setAutomationProposals(proposals);
        setAutomationRuntime(runtime);
      })
      .catch(showError);
    const offProposal = window.waypoint.onAutomationProposalCreated((event) => {
        if (event.workspaceId === workspace.id)
          void window.waypoint
            .automationProposals(workspace.id)
            .then(setAutomationProposals)
            .catch(showError);
      }),
      offWebhook = window.waypoint.onWebhookEventsImported((event) => {
        if (event.workspaceId === workspace.id)
          void window.waypoint
            .listWebhookEvents(workspace.id)
            .then(setWebhookEvents)
            .catch(showError);
      }),
      offRun = window.waypoint.onAutomationRunUpdated((event) => {
        if (event.workspaceId === workspace.id)
          void Promise.all([
            window.waypoint.automationRulesAndRuns(workspace.id),
            window.waypoint.listWebhookEvents(workspace.id),
          ])
            .then(([runtime, inbound]) => {
              setAutomationRuntime(runtime);
              setWebhookEvents(inbound);
            })
            .catch(showError);
      });
    return () => {
      offProposal();
      offWebhook();
      offRun();
    };
  }, [workspace]);
  const autoTitleRefreshRef = useRef(refresh);
  autoTitleRefreshRef.current = refresh;
  const autoTitleChat = chats.find((item) => item.id === selectedChatId),
    autoTitleChatId = autoTitleChat?.id,
    autoTitleStatus = autoTitleChat?.titleStatus,
    autoTitleReady = Boolean(
      autoTitleChat?.messages.some(
        (item) => item.role === "user" && item.body.trim().length >= 3,
      ) &&
      autoTitleChat.messages.some(
        (item) => item.role === "assistant" && item.body.trim().length >= 3,
      ),
    ),
    autoTitleWorkspaceId = workspace?.id;
  useEffect(() => {
    if (!autoTitleWorkspaceId || !autoTitleChatId) return;
    const shouldStart = autoTitleStatus === "eligible" && autoTitleReady,
      shouldPoll = autoTitleStatus === "running";
    if (!shouldStart && !shouldPoll) return;
    let disposed = false,
      timer: number | undefined,
      attempts = 0;
    const poll = () => {
        if (disposed) return;
        attempts += 1;
        void autoTitleRefreshRef.current().catch(showError);
        if (attempts >= 40 && timer) window.clearInterval(timer);
      },
      beginPolling = () => {
        if (disposed) return;
        poll();
        timer = window.setInterval(poll, 750);
      };
    if (shouldPoll) beginPolling();
    else
      void window.waypoint
        .ensureChatTitle(autoTitleWorkspaceId, autoTitleChatId)
        .then(({ started }) => {
          if (started) beginPolling();
          else if (!disposed)
            void autoTitleRefreshRef.current().catch(showError);
        })
        .catch(() => undefined);
    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
    };
  }, [autoTitleWorkspaceId, autoTitleChatId, autoTitleStatus, autoTitleReady]);
  useEffect(() => {
    const available = capabilities.find(
      (item) =>
        item.available &&
        item.compatible !== false &&
        (item.name !== "grok" ||
          cliModels.some(
            (catalog) => catalog.provider === "grok" && catalog.ready,
          )),
    );
    if (chatCli === "openrouter") return;
    if (
      !available ||
      capabilities.some(
        (item) =>
          item.name === chatCli &&
          item.available &&
          item.compatible !== false &&
          (item.name !== "grok" ||
            cliModels.some(
              (catalog) => catalog.provider === "grok" && catalog.ready,
            )),
      )
    )
      return;
    const timer = window.setTimeout(() => setChatCli(available.name), 0);
    return () => window.clearTimeout(timer);
  }, [capabilities, chatCli, cliModels]);
  useEffect(() => {
    if (!attachmentViewer) return;
    const background = [
      ...document.querySelectorAll<HTMLElement>(
        ".app-frame > :not(.attachment-viewer)",
      ),
    ];
    for (const item of background) item.inert = true;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAttachmentViewer(undefined);
      if (event.key === "Tab") {
        event.preventDefault();
        document
          .querySelector<HTMLElement>(".attachment-viewer button")
          ?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      for (const item of background) item.inert = false;
      viewerReturnFocusRef.current?.focus();
      viewerReturnFocusRef.current = null;
    };
  }, [attachmentViewer]);
  useEffect(() => {
    attachmentContextRef.current = {
      workspaceId: workspace?.id,
      chatId: selectedChatId,
    };
    pasteAttemptRef.current += 1;
    const timer = window.setTimeout(() => setAttachmentViewer(undefined), 0);
    return () => window.clearTimeout(timer);
  }, [workspace?.id, selectedChatId]);
  useEffect(() => {
    void Promise.resolve()
      .then(refreshOpenRouter)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (drawer !== "settings") return;
    void Promise.resolve()
      .then(() => Promise.all([loadVoiceCapability(), refreshCliProviders()]))
      .catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshes are intentionally sampled whenever Settings opens
  }, [drawer]);
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);
  useEffect(() => {
    transcriptFollowingRef.current = true;
    requestAnimationFrame(() => {
      const element = transcriptRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }, [selectedChatId]);
  useEffect(() => {
    if (!transcriptFollowingRef.current) return;
    requestAnimationFrame(() => {
      const element = transcriptRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }, [chats, runs, selectedChatId]);
  useEffect(() => {
    const offChunk = window.waypoint.onVoiceAudioChunk((event) => {
        if (
          event.workspaceId === workspace?.id &&
          event.chatId === selectedChatId &&
          event.turnId === voiceTurnRef.current
        )
          void voicePlayerRef.current.push(event);
      }),
      offEnd = window.waypoint.onVoiceAudioEnd((event) =>
        voicePlayerRef.current.end(event),
      ),
      offStop = window.waypoint.onVoiceAudioStop(
        (event) => void voicePlayerRef.current.stop(event),
      );
    return () => {
      offChunk();
      offEnd();
      offStop();
    };
  }, [workspace, selectedChatId]);
  // Speech completion is accepted only for the exact live turn and visible state.
  useEffect(
    () =>
      window.waypoint.onVoiceSpeechState((event) => {
        if (
          event.workspaceId !== workspace?.id ||
          event.chatId !== selectedChatId ||
          event.turnId !== voiceTurnRef.current ||
          voiceStateRef.current !== "speaking"
        )
          return;
        if (event.result !== "completed")
          void voicePlayerRef.current.stop(event);
        void voiceMonitorRef.current.stop();
        if (event.result === "failed") {
          setVoiceSessionActive(false);
          voiceStateRef.current = "off";
          setVoiceState("off");
          setVoicePartial("");
          setError(
            "Local speech playback failed. Open Settings for voice diagnostics.",
          );
          return;
        }
        if (
          event.result === "completed" &&
          voiceMode === "hands_free" &&
          voiceSessionActive
        ) {
          voiceStateRef.current = "listening";
          setVoiceState("listening");
          setVoicePartial("Listening…");
          void startVoiceCapture(true);
          return;
        }
        voiceStateRef.current = "off";
        setVoiceState("off");
        setVoicePartial("");
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exact-turn refs deliberately decouple the capture callback identity
    [workspace, selectedChatId, voiceMode, voiceDevice, voiceSessionActive],
  );
  // The exact-turn refs intentionally guard this asynchronous native speech bridge.
  useEffect(() => {
    if (voiceState !== "thinking" || !workspace || !selectedChatId) return;
    const voice = voiceRunRef.current;
    if (
      !voice ||
      voice.turn !== voiceTurnRef.current ||
      voice.workspaceId !== workspace.id ||
      voice.chatId !== selectedChatId ||
      !voice.runId ||
      voice.spoken
    )
      return;
    const run = runs.find((item) => String(item.id) === voice.runId);
    if (!run) return;
    if (["failed", "timed_out", "canceled"].includes(String(run.status))) {
      setVoiceSessionActive(false);
      setVoiceState("off");
      setVoicePartial("");
      setError(
        `Voice turn ${String(run.status).replace("_", " ")}; no stale response will be spoken.`,
      );
      return;
    }
    if (
      run.status !== "completed" ||
      typeof run.assistantMessageId !== "string"
    )
      return;
    const chat = chats.find((item) => item.id === selectedChatId),
      answer = chat?.messages.find(
        (item) =>
          item.id === run.assistantMessageId && item.role === "assistant",
      )?.body;
    if (!answer?.trim()) return;
    voice.spoken = true;
    const turn = voice.turn;
    setVoicePartial("Speaking… say something to interrupt");
    voiceStateRef.current = "speaking";
    setVoiceState("speaking");
    void window.waypoint
      .speakVoice(workspace.id, selectedChatId, turn, answer)
      .then(async () => {
        if (
          turn !== voiceTurnRef.current ||
          voiceStateRef.current !== "speaking"
        )
          return;
        if (voiceMode === "hands_free" && voiceSessionActive)
          await voiceMonitorRef.current
            .start(
              voiceDevice || undefined,
              () => void bargeInVoice(turn),
              () => void finishBargeCapture(turn),
              (reason) => void failVoiceCapture(reason),
            )
            .catch((reason) => {
              setError(
                `Barge-in monitor unavailable: ${reason instanceof Error ? reason.message : String(reason)}. Playback can still be stopped with the voice control.`,
              );
            });
      })
      .catch((reason) => {
        if (turn === voiceTurnRef.current) {
          setVoiceSessionActive(false);
          voiceStateRef.current = "off";
          setVoiceState("off");
          setVoicePartial("");
          showError(reason);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exact-turn refs guard these intentionally sampled voice operations
  }, [
    voiceState,
    workspace,
    selectedChatId,
    chats,
    runs,
    voiceMode,
    voiceSessionActive,
    voiceDevice,
  ]);
  useEffect(() => {
    const prior = voiceScopeRef.current,
      next = { workspaceId: workspace?.id, chatId: selectedChatId },
      changed = Boolean(
        prior.workspaceId &&
        (prior.workspaceId !== next.workspaceId ||
          prior.chatId !== next.chatId),
      );
    voiceScopeRef.current = next;
    if (changed) {
      voiceTurnRef.current++;
      voiceCaptureTargetRef.current = undefined;
      voiceStateRef.current = "off";
      setVoiceSessionActive(false);
      setVoiceState("off");
      setVoicePartial("");
      void voiceCaptureRef.current.cancel();
      void voiceMonitorRef.current.stop();
      if (prior.workspaceId && prior.chatId)
        void window.waypoint
          .stopVoice(prior.workspaceId, prior.chatId)
          .catch(() => undefined);
    }
  }, [workspace, selectedChatId]);
  useEffect(
    () =>
      window.waypoint.onToolProgress((raw) => {
        const event = raw as {
          runId: string;
          workspaceId: string;
          chatId?: string;
          tool: string;
          sequence: number;
          type: string;
          summary: string;
          output?: string;
          createdAt: string;
        };
        if (
          event.workspaceId !== workspace?.id ||
          event.chatId !== selectedChatId ||
          event.tool !== "agent_browser.run"
        )
          return;
        setBrowserActivity((current) =>
          [
            ...current.filter(
              (item) =>
                !(
                  item.runId === event.runId && item.sequence === event.sequence
                ),
            ),
            event,
          ]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-30),
        );
        if (["completed", "failed", "canceled"].includes(event.type)) {
          browserTerminalRunsRef.current.add(event.runId);
          setActiveBrowserRun((current) =>
            current === event.runId ? undefined : current,
          );
          const body = `Browser ${event.type} · ${event.summary}\n\nRun ${event.runId}${event.output?.trim() ? `\n\n${event.output.trim().slice(0, 65_536)}` : ""}`;
          if (workspace && event.chatId)
            void window.waypoint
              .addMessage(workspace.id, event.chatId, "system", body, [])
              .then(() => refresh())
              .catch(showError);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- browser events refresh through the generation-gated refresh function
    [workspace, selectedChatId],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTabMenu(undefined);
        setSidebarOpen(false);
      }
      if (
        primaryShortcutPressed(platform, event) &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        void beginNewChat();
      }
      if (
        primaryShortcutPressed(platform, event) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        openViewTab("knowledge");
      }
      if (
        primaryShortcutPressed(platform, event) &&
        event.shiftKey &&
        event.key.toLowerCase() === "p" &&
        activityCapture?.policy.enabled &&
        !activityCapture.policy.paused
      ) {
        event.preventDefault();
        void updateActivityCapture({ paused: true }).catch(showError);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (drawer !== "knowledge" || !activityKnowledgeTarget) return;
    const timer = window.setTimeout(
      () =>
        document
          .getElementById(`activity-target-${activityKnowledgeTarget}`)
          ?.scrollIntoView({ block: "center" }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [drawer, activityKnowledgeTarget]);
  useEffect(() => {
    if (drawer !== "settings" || !workspace) return;
    settingsOpenRef.current = true;
    let current = true;
    const generation = openRouterDraftGenerationRef.current;
    void Promise.all([
      window.waypoint.toolGatewaySettings(workspace.id),
      window.waypoint.toolGatewayReceipts(workspace.id),
      window.waypoint.toolFailures(workspace.id),
      window.waypoint.toolGatewayCapabilities(),
      window.waypoint.openRouterStatus(),
      window.waypoint.browserDiscovery(),
      window.waypoint.chatThinkingPreferences(workspace.id),
    ])
      .then(
        ([settings, receipts, failures, caps, provider, browsers, thinking]) => {
          if (
            !current ||
            !settingsOpenRef.current ||
            generation !== openRouterDraftGenerationRef.current
          )
            return;
          setToolSettings(settings);
          setDenyDraft(settings.denyPatterns.join("\n"));
          setToolReceipts(receipts);
          setToolFailures(failures);
          setToolCapabilities(caps);
          setOpenRouter(provider);
          setOpenRouterSettingsDraft(provider.settings);
          setOpenRouterThinkingDraft({
            openrouterStrategic: thinking.openrouterStrategic,
            openrouterEveryday: thinking.openrouterEveryday,
            openrouterAttachment: thinking.openrouterAttachment,
          });
          setInstalledBrowsers(browsers);
        },
      )
      .catch(showError);
    return () => {
      current = false;
      settingsOpenRef.current = false;
    };
  }, [drawer, workspace]);
  useEffect(() => {
    if (drawer !== "settings" || !workspace) return;
    let current = true;
    void window.waypoint
      .crossWorkspaceRollupSettings(workspace.id)
      .then((value) => {
        if (current) setRollupSettings(value);
      })
      .catch(showError);
    return () => {
      current = false;
    };
  }, [drawer, workspace]);
  useEffect(() => {
    if (drawer !== "knowledge" || !workspace) return;
    let current = true;
    void Promise.all(
      documents.map(
        async (item) =>
          [
            item.id,
            await window.waypoint.documentIndexStatus(workspace.id, item.id),
          ] as const,
      ),
    )
      .then((entries) => {
        if (current) setDocumentIndexes(Object.fromEntries(entries));
      })
      .catch(showError);
    return () => {
      current = false;
    };
  }, [drawer, workspace, documents]);
  useEffect(() => {
    if (drawer !== "activity" || !workspace) return;
    let current = true;
    void Promise.all([
      window.waypoint.activityCaptureStatus(workspace.id),
      window.waypoint.listActivitySnapshots(
        workspace.id,
        activitySnapshotQuery,
      ),
    ])
      .then(([status, snapshots]) => {
        if (!current) return;
        setActivityCapture(status);
        setActivitySnapshots(snapshots);
        setActivityExclusions(status.policy.exclusions.join("\n"));
      })
      .catch(showError);
    return () => {
      current = false;
    };
  }, [drawer, workspace, activitySnapshotQuery]);
  useEffect(() => {
    if (drawer === "activity") return;
    const timer = window.setTimeout(() => setActivityPreview(undefined), 0);
    return () => window.clearTimeout(timer);
  }, [drawer]);
  useEffect(() => {
    if (!sidebarOpen) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const focusable = () => [
      ...overlay.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    ];
    window.setTimeout(() => focusable()[0]?.focus(), 0);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0],
        last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener("keydown", trap);
    return () => {
      overlay.removeEventListener("keydown", trap);
      previousFocusRef.current?.focus();
    };
  }, [sidebarOpen]);
  useEffect(() => {
    if (!workspaceDialog) return;
    workspaceDialogOpenerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = workspaceDialogRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setWorkspaceDialog(undefined);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = [
        ...dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled])",
        ),
      ];
      if (!items.length) return;
      const first = items[0],
        last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.setTimeout(() => workspaceDialogOpenerRef.current?.focus(), 0);
    };
  }, [workspaceDialog]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await window.waypoint.createWorkspace(
        String(new FormData(event.currentTarget).get("name") ?? ""),
      );
      setWorkspaces((current) => [...current, created]);
      await selectWorkspace(created);
    } catch (reason) {
      showError(reason);
    }
  }
  async function addWorkspace(name: string) {
    if (!name.trim()) return;
    try {
      const created = await window.waypoint.createWorkspace(name);
      await selectWorkspace(created);
      setWorkspaces((await window.waypoint.bootstrap()).workspaces);
      setNotice(`Workspace “${created.name}” created.`);
      setWorkspaceDialog(undefined);
      setWorkspaceNameDraft("");
    } catch (reason) {
      showError(reason);
    }
  }
  async function chooseWorkspaceExecutionRoot() {
    if (!workspace) return;
    const result = await window.waypoint.chooseWorkspaceExecutionRoot(
      workspace.id,
    );
    if (result.canceled) return;
    setWorkspace(result.workspace);
    setWorkspaces((await window.waypoint.bootstrap()).workspaces);
    await refresh(result.workspace);
    setNotice(
      `Agent repository set to ${result.workspace.executionRoot}. Existing provider sessions were invalidated.`,
    );
  }
  async function clearWorkspaceExecutionRoot() {
    if (!workspace) return;
    const updated = await window.waypoint.clearWorkspaceExecutionRoot(
      workspace.id,
    );
    setWorkspace(updated);
    setWorkspaces((await window.waypoint.bootstrap()).workspaces);
    await refresh(updated);
    setNotice(
      "Agent repository cleared. Chats now use Waypoint’s private read-only working area until you choose a repository.",
    );
  }
  async function decideProviderRequest(
    requestId: string,
    status: "accepted" | "accepted_session" | "declined" | "canceled",
    decision: Record<string, unknown> = {},
  ) {
    if (!workspace) return;
    await window.waypoint.resolveProviderRequest(
      workspace.id,
      requestId,
      status,
      decision,
    );
    await refresh();
  }
  async function removeWorkspace() {
    if (!workspace || workspaces.length <= 1) return;
    try {
      await window.waypoint.deleteWorkspace(workspace.id);
      const remaining = (await window.waypoint.bootstrap()).workspaces;
      setWorkspaces(remaining);
      await selectWorkspace(remaining[0]);
      setNotice(`Workspace “${workspace.name}” permanently deleted.`);
      setWorkspaceDialog(undefined);
    } catch (reason) {
      showError(reason);
    }
  }
  async function beginNewChat() {
    if (!workspace) return;
    try {
      const id = await window.waypoint.createChat(workspace.id, "New chat");
      await refresh();
      openChatTab(id);
    } catch (reason) {
      showError(reason);
    }
  }
  async function dispatchOfficeWorkOrder(order: OfficeWorkOrder) {
    if (!workspace) throw new Error("Workspace is unavailable");
    let result;
    try {
      result = await dispatchConfirmedOfficeWorkOrder(
        {
          createChat: (workspaceId, title) =>
            window.waypoint.createChat(workspaceId, title),
          addMessage: (workspaceId, chatId, role, body, attachmentIds) =>
            window.waypoint.addMessage(
              workspaceId,
              chatId,
              role,
              body,
              attachmentIds,
            ),
          runLocal: (input) =>
            window.waypoint.runChat(
              input.workspaceId,
              input.chatId,
              input.sourceMessageId,
              input.provider,
              input.securityProfileId,
              input.prompt,
              input.model,
              undefined,
              [],
            ),
          runHosted: (input) =>
            window.waypoint.runOpenRouterChat({
              workspaceId: input.workspaceId,
              chatId: input.chatId,
              sourceMessageId: input.sourceMessageId,
              prompt: input.prompt,
              role: "everyday",
              securityProfileId: input.securityProfileId,
              attachmentIds: [],
            }),
        },
        workspace.id,
        order,
      );
    } catch (reason) {
      await refresh().catch(() => undefined);
      throw reason;
    }
    const refreshed = await refreshAfterOfficeDispatch(refresh);
    if (refreshed) {
      setNotice(
        `${order.provider === "openrouter" ? "OpenRouter" : order.provider} work order dispatched. Select the worker for live status.`,
      );
    } else {
      setNotice(
        "Work order dispatched successfully. Office status refresh is delayed; do not dispatch it again.",
      );
    }
    return {
      ...result,
      statusRefresh: refreshed ? ("current" as const) : ("delayed" as const),
    };
  }
  async function chooseAttachments() {
    if (!workspace || !selectedChatId) return;
    setAttachmentBusy(true);
    try {
      const result = await window.waypoint.selectChatAttachments(
        workspace.id,
        selectedChatId,
      );
      setAttachments(result.attachments);
    } catch (reason) {
      showError(reason);
    } finally {
      setAttachmentBusy(false);
    }
  }
  async function importDocument() {
    if (!workspace) return;
    setDocumentImportBusy(true);
    setError("");
    try {
      const result = await window.waypoint.importDocument(workspace.id);
      if (result.canceled) return;
      if (result.state === "failed") {
        setError(result.message ?? "Local document extraction failed.");
        return;
      }
      setNotice(
        result.state === "indexed"
          ? `${result.sourceName} imported and indexed in ${result.chunkCount} local chunks with ${result.model}.`
          : result.state === "provider_unavailable"
            ? `${result.sourceName} imported for lexical search. ${result.model} is unavailable, so semantic indexing is waiting.`
            : `${result.sourceName} imported for lexical search. ${result.message ?? "Local semantic indexing is busy or failed; retry from Knowledge."}`,
      );
      await refresh();
    } catch (reason) {
      showError(reason);
    } finally {
      setDocumentImportBusy(false);
    }
  }
  async function reindexDocument(documentId: string) {
    if (!workspace) return;
    setDocumentImportBusy(true);
    setError("");
    try {
      const result = await window.waypoint.reindexImportedDocument(
        workspace.id,
        documentId,
      );
      setNotice(
        result.state === "indexed"
          ? `Local semantic index rebuilt in ${result.chunkCount} chunks with ${result.model}.`
          : result.state === "provider_unavailable"
            ? `${result.model} is unavailable. The imported document remains available to lexical search.`
            : (result.message ?? "Local semantic indexing is busy or failed."),
      );
      if (result.state === "indexed")
        setDocumentIndexes((current) => ({
          ...current,
          [documentId]: {
            ...current[documentId],
            state: "indexed",
            chunkCount: result.chunkCount,
            sourceAvailable: true,
            provider: result.provider,
            model: result.model,
            modelDigest: result.modelDigest,
            retainedGenerations: Math.max(
              1,
              current[documentId]?.retainedGenerations ?? 0,
            ),
          },
        }));
    } catch (reason) {
      showError(reason);
    } finally {
      setDocumentImportBusy(false);
    }
  }
  async function rollbackDocumentIndex(documentId: string) {
    if (!workspace) return;
    setDocumentImportBusy(true);
    try {
      const result = await window.waypoint.rollbackDocumentIndex(
        workspace.id,
        documentId,
      );
      setDocumentIndexes((current) => ({ ...current, [documentId]: result }));
      setNotice(
        `Prior complete index generation selected (${result.model}). Semantic search resumes only when its exact local model digest is installed.`,
      );
    } catch (reason) {
      showError(reason);
    } finally {
      setDocumentImportBusy(false);
    }
  }
  async function removeAttachment(id: string) {
    if (!workspace || !selectedChatId) return;
    attachmentOperationsRef.current += 1;
    setAttachmentBusy(true);
    try {
      if (attachmentViewer?.id === id) setAttachmentViewer(undefined);
      await window.waypoint.deleteAttachment(workspace.id, id);
      setAttachments(
        await window.waypoint.listChatAttachments(workspace.id, selectedChatId),
      );
    } catch (reason) {
      showError(reason);
    } finally {
      attachmentOperationsRef.current = Math.max(
        0,
        attachmentOperationsRef.current - 1,
      );
      setAttachmentBusy(attachmentOperationsRef.current > 0);
    }
  }
  async function pasteChatImages(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!workspace || !selectedChatId) return;
    const images = [...event.clipboardData.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!images.length) return;
    event.preventDefault();
    const target = {
      workspaceId: workspace.id,
      chatId: selectedChatId,
      attempt: ++pasteAttemptRef.current,
    };
    const added: string[] = [];
    attachmentOperationsRef.current += 1;
    setAttachmentBusy(true);
    try {
      const allowed: Record<string, string> = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
      };
      for (const [index, file] of images.entries()) {
        if (file.size < 1) throw new Error("Pasted images must not be empty");
        const extension = allowed[file.type];
        if (!extension)
          throw new Error(`Pasted ${file.type || "image"} is not supported`);
        const base =
          file.name && file.name !== "image.png"
            ? file.name
            : `pasted-image-${Date.now()}-${index + 1}${extension}`;
        const name = base.toLowerCase().endsWith(extension)
          ? base
          : `${base.replace(/\.[^.]+$/, "")}${extension}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const current = attachmentContextRef.current;
        if (
          pasteAttemptRef.current !== target.attempt ||
          current.workspaceId !== target.workspaceId ||
          current.chatId !== target.chatId
        )
          throw new Error(
            "Image paste was canceled because the active chat changed",
          );
        const result = await window.waypoint.addPastedChatImage(
          target.workspaceId,
          target.chatId,
          name,
          file.type,
          bytes,
        );
        added.push(result.attachment.id);
        const after = attachmentContextRef.current;
        if (
          pasteAttemptRef.current !== target.attempt ||
          after.workspaceId !== target.workspaceId ||
          after.chatId !== target.chatId
        )
          throw new Error(
            "Image paste was canceled because the active chat changed",
          );
        setAttachments((current) =>
          current.some((item) => item.id === result.attachment.id)
            ? current
            : [...current, result.attachment],
        );
      }
    } catch (reason) {
      const cleanup = await Promise.allSettled(
          added.map((id) =>
            window.waypoint.deleteAttachment(target.workspaceId, id),
          ),
        ),
        cleanupFailed = cleanup.some((item) => item.status === "rejected");
      if (
        attachmentContextRef.current.workspaceId === target.workspaceId &&
        attachmentContextRef.current.chatId === target.chatId
      ) {
        setAttachments(
          await window.waypoint
            .listChatAttachments(target.workspaceId, target.chatId)
            .catch(() => []),
        );
        showError(
          cleanupFailed
            ? `${reason instanceof Error ? reason.message : String(reason)} A partially pasted image could not be removed; remove it from the prior chat before retrying.`
            : reason,
        );
      } else if (cleanupFailed) {
        setError(
          "A canceled pasted image could not be removed from the prior chat. Return to that chat and remove it before retrying.",
        );
      }
    } finally {
      attachmentOperationsRef.current = Math.max(
        0,
        attachmentOperationsRef.current - 1,
      );
      setAttachmentBusy(attachmentOperationsRef.current > 0);
    }
  }
  function showAttachmentViewer(viewer: AttachmentViewer) {
    const current = attachmentContextRef.current;
    if (
      current.workspaceId === viewer.workspaceId &&
      current.chatId === viewer.chatId
    ) {
      viewerReturnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setAttachmentViewer(viewer);
    }
  }
  async function updateActivityCapture(
    patch: Partial<ActivityCaptureStatus["policy"]>,
  ) {
    if (!workspace || !activityCapture) return;
    const exclusions =
      patch.exclusions ??
      activityExclusions
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    const status = await window.waypoint.updateActivityCapture(workspace.id, {
      ...activityCapture.policy,
      ...patch,
      exclusions,
    });
    setActivityCapture(status);
    setActivityExclusions(status.policy.exclusions.join("\n"));
    setActivitySnapshots(
      await window.waypoint.listActivitySnapshots(
        workspace.id,
        activitySnapshotQuery,
      ),
    );
  }
  async function removeActivitySnapshot(id: string) {
    if (!workspace) return;
    await window.waypoint.deleteActivitySnapshot(workspace.id, id);
    setActivitySnapshots(
      await window.waypoint.listActivitySnapshots(
        workspace.id,
        activitySnapshotQuery,
      ),
    );
    setActivityCapture(
      await window.waypoint.activityCaptureStatus(workspace.id),
    );
  }
  async function previewActivitySnapshot(id: string) {
    if (!workspace) return;
    const value = await window.waypoint.readActivitySnapshot(workspace.id, id);
    setActivityPreview({
      id,
      url: `data:${value.mediaType};base64,${value.dataBase64}`,
    });
  }
  async function removeAllActivitySnapshots() {
    if (!workspace) return;
    const result = await window.waypoint.deleteAllActivitySnapshots(
      workspace.id,
    );
    setNotice(
      `${result.deleted} raw activity snapshot${result.deleted === 1 ? "" : "s"} permanently deleted.`,
    );
    setActivitySnapshots([]);
    setActivityCapture(
      await window.waypoint.activityCaptureStatus(workspace.id),
    );
  }
  async function loadVoiceCapability() {
    const capability = await window.waypoint.voiceCapability();
    setVoiceCapability(capability);
    if (workspace)
      setVoiceEngineStatus(
        await window.waypoint.voiceEngineStatus(workspace.id),
      );
    if (navigator.mediaDevices?.enumerateDevices) {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (item) => item.kind === "audioinput",
      );
      setVoiceDevices(devices);
      if (!voiceDevice && devices[0]) setVoiceDevice(devices[0].deviceId);
    }
    return capability;
  }
  async function failVoiceCapture(reason: "device_lost" | "capture_limit") {
    await stopVoiceMode();
    setError(
      reason === "device_lost"
        ? "The selected microphone disconnected. Open Settings to choose another device."
        : "The two-minute voice capture limit was reached.",
    );
  }
  async function startVoiceCapture(interruptionAlreadyHandled = false) {
    if (!workspace || !selectedChat) return;
    const attempt = voiceTurnRef.current,
      target = { workspaceId: workspace.id, chatId: selectedChat.id };
    voiceCaptureTargetRef.current = target;
    setError("");
    try {
      const capability = voiceCapability ?? (await loadVoiceCapability());
      if (!capability.stt.available) {
        voiceCaptureTargetRef.current = undefined;
        setVoiceSessionActive(false);
        setError(
          `${capability.stt.reason} Open Settings for voice diagnostics.`,
        );
        return;
      }
      if (
        !interruptionAlreadyHandled &&
        (voiceStateRef.current === "thinking" ||
          voiceStateRef.current === "speaking")
      ) {
        const exact = voiceRunRef.current;
        if (exact?.runId) await cancelRun(exact.runId);
        await window.waypoint.stopVoice(target.workspaceId, target.chatId);
      }
      await voiceCaptureRef.current.start(
        voiceDevice || undefined,
        (reason) => void failVoiceCapture(reason),
        voiceMode === "hands_free"
          ? () => void finishVoiceCapture()
          : undefined,
      );
      const scope = voiceScopeRef.current;
      if (
        attempt !== voiceTurnRef.current ||
        scope.workspaceId !== target.workspaceId ||
        scope.chatId !== target.chatId
      ) {
        await voiceCaptureRef.current.cancel();
        return;
      }
      voiceTurnRef.current++;
      voiceRunRef.current = undefined;
      setVoicePartial("Listening…");
      voiceStateRef.current = "listening";
      setVoiceState("listening");
      if (voiceMode === "push_to_talk" && voicePressReleasedRef.current)
        await finishVoiceCapture();
    } catch (reason) {
      voiceCaptureTargetRef.current = undefined;
      setVoiceSessionActive(false);
      voiceStateRef.current = "off";
      setVoiceState("off");
      setVoicePartial("");
      showError(reason);
    }
  }
  async function bargeInVoice(turn: number) {
    if (
      !workspace ||
      !selectedChat ||
      voiceMode !== "hands_free" ||
      !voiceSessionActive ||
      turn !== voiceTurnRef.current ||
      voiceStateRef.current !== "speaking"
    )
      return;
    const target = { workspaceId: workspace.id, chatId: selectedChat.id },
      stop = window.waypoint.stopVoice(target.workspaceId, target.chatId);
    voiceStateRef.current = "listening";
    setVoiceState("listening");
    setVoicePartial("Listening…");
    await stop;
    if (
      turn !== voiceTurnRef.current ||
      voiceScopeRef.current.workspaceId !== target.workspaceId ||
      voiceScopeRef.current.chatId !== target.chatId
    )
      await voiceMonitorRef.current.stop();
  }
  async function finishBargeCapture(turn: number) {
    const scope = voiceScopeRef.current;
    if (
      !workspace ||
      !selectedChat ||
      turn !== voiceTurnRef.current ||
      scope.workspaceId !== workspace.id ||
      scope.chatId !== selectedChat.id ||
      voiceStateRef.current !== "listening"
    )
      return;
    const target = { workspaceId: workspace.id, chatId: selectedChat.id };
    voiceStateRef.current = "transcribing";
    setVoiceState("transcribing");
    setVoicePartial("Transcribing locally…");
    let wav: Uint8Array | undefined;
    try {
      wav = await voiceMonitorRef.current.finish();
      if (
        turn !== voiceTurnRef.current ||
        voiceScopeRef.current.workspaceId !== target.workspaceId ||
        voiceScopeRef.current.chatId !== target.chatId
      )
        return;
      const result = await window.waypoint.transcribeVoice(
          target.workspaceId,
          target.chatId,
          "hands_free",
          wav,
        ),
        prompt = result.text.trim();
      if (
        turn !== voiceTurnRef.current ||
        voiceScopeRef.current.workspaceId !== target.workspaceId ||
        voiceScopeRef.current.chatId !== target.chatId
      )
        return;
      if (!prompt)
        throw new Error("The local runtime returned an empty transcript.");
      const textarea = composerRef.current;
      if (!textarea)
        throw new Error(
          "Voice target changed; the transcript was not submitted.",
        );
      textarea.value = prompt;
      voiceSubmissionRef.current = turn;
      voiceRunRef.current = {
        turn,
        workspaceId: target.workspaceId,
        chatId: target.chatId,
      };
      voiceStateRef.current = "thinking";
      setVoiceState("thinking");
      setVoicePartial("Thinking…");
      textarea.form?.requestSubmit();
    } catch (reason) {
      if (turn === voiceTurnRef.current) {
        setVoiceSessionActive(false);
        voiceStateRef.current = "off";
        setVoiceState("off");
        setVoicePartial("");
        showError(reason);
      }
    } finally {
      wav?.fill(0);
    }
  }
  async function finishVoiceCapture() {
    const target = voiceCaptureTargetRef.current;
    if (
      !workspace ||
      !selectedChat ||
      !target ||
      voiceStateRef.current !== "listening"
    )
      return;
    const turn = voiceTurnRef.current;
    let wav: Uint8Array | undefined;
    voiceStateRef.current = "transcribing";
    setVoiceState("transcribing");
    setVoicePartial("Transcribing locally…");
    try {
      wav = await voiceCaptureRef.current.stop();
      if (
        turn !== voiceTurnRef.current ||
        workspace.id !== target.workspaceId ||
        selectedChat.id !== target.chatId
      )
        return;
      const result = await window.waypoint.transcribeVoice(
        target.workspaceId,
        target.chatId,
        voiceMode,
        wav,
      );
      if (
        turn !== voiceTurnRef.current ||
        workspace.id !== target.workspaceId ||
        selectedChat.id !== target.chatId
      )
        return;
      const prompt = result.text.trim();
      if (!prompt)
        throw new Error("The local runtime returned an empty transcript.");
      setVoicePartial("Thinking…");
      const textarea = composerRef.current;
      if (!textarea || selectedChatId !== target.chatId)
        throw new Error(
          "Voice target changed; the transcript was not submitted.",
        );
      textarea.value = prompt;
      voiceSubmissionRef.current = turn;
      voiceRunRef.current = {
        turn,
        workspaceId: target.workspaceId,
        chatId: target.chatId,
      };
      voiceStateRef.current = "thinking";
      setVoiceState("thinking");
      textarea.form?.requestSubmit();
    } catch (reason) {
      if (turn === voiceTurnRef.current) {
        setVoiceSessionActive(false);
        voiceStateRef.current = "off";
        setVoiceState("off");
        setVoicePartial("");
        showError(reason);
      }
    } finally {
      voiceCaptureTargetRef.current = undefined;
      wav?.fill(0);
    }
  }
  async function stopVoiceMode() {
    setVoiceSessionActive(false);
    voiceTurnRef.current++;
    voiceSubmissionRef.current = undefined;
    voiceCaptureTargetRef.current = undefined;
    await Promise.all([
      voiceCaptureRef.current.cancel(),
      voiceMonitorRef.current.stop(),
      voicePlayerRef.current.stop(),
    ]);
    if (workspace && selectedChat)
      await window.waypoint
        .stopVoice(workspace.id, selectedChat.id)
        .catch(() => undefined);
    const exact = voiceRunRef.current;
    if (exact?.runId) await cancelRun(exact.runId).catch(() => undefined);
    voiceRunRef.current = undefined;
    voiceStateRef.current = "off";
    setVoiceState("off");
    setVoicePartial("");
  }
  async function toggleHandsFree() {
    if (voiceSessionActive) {
      await stopVoiceMode();
      return;
    }
    setVoiceSessionActive(true);
    await startVoiceCapture();
  }
  function beginPushToTalk() {
    voicePressReleasedRef.current = false;
    void startVoiceCapture();
  }
  function releasePushToTalk() {
    voicePressReleasedRef.current = true;
    void finishVoiceCapture();
  }
  async function saveVoicePreferences(
    nextMode = voiceMode,
    nextDevice = voiceDevice,
    nextEngine = voiceEngine,
  ) {
    if (!workspace) return;
    const value = await window.waypoint.updateVoicePreferences(workspace.id, {
      mode: nextMode,
      microphoneId: nextDevice,
      outputVoice: "system",
      engine: nextEngine,
    });
    setVoiceMode(value.mode);
    setVoiceDevice(value.microphoneId);
    setVoiceEngine(value.engine);
    setVoiceEngineStatus(await window.waypoint.voiceEngineStatus(workspace.id));
    setNotice("Voice preferences saved for this workspace on this device.");
  }
  async function runChat(event: FormEvent<HTMLFormElement>, chatId: string) {
    event.preventDefault();
    if (!workspace) return;
    const form = event.currentTarget,
      data = new FormData(form),
      prompt = String(data.get("prompt") ?? ""),
      cli = String(data.get("cli") ?? chatCli) as
        "codex" | "claude" | "grok" | "openrouter",
      profile = selectedProfileId,
      model = String(data.get("model") ?? "") || undefined,
      attachmentIds = attachments
        .filter((item) => item.ownerId === chatId)
        .map((item) => item.id);
    setError("");
    const voiceTurn = voiceSubmissionRef.current;
    if (voiceTurn !== undefined) voiceSubmissionRef.current = undefined;
    try {
      const browserAction = parseBrowserChatCommand(prompt);
      if (browserAction) {
        if (toolSettings?.browserProfileMode !== "existing")
          openViewTab("browser");
        if (attachmentIds.length)
          throw new Error(
            "Browser commands do not consume chat attachments. Use /browser upload @e1 relative-file inside the trusted workspace.",
          );
        await window.waypoint.addMessage(
          workspace.id,
          chatId,
          "user",
          prompt,
          [],
        );
        form.reset();
        await refresh();
        const started = await window.waypoint.executeTool({
          version: 1,
          workspaceId: workspace.id,
          tool: "agent_browser.run",
          arguments: { action: browserAction, contextChatId: chatId },
        });
        if (!browserTerminalRunsRef.current.has(started.runId))
          setActiveBrowserRun(started.runId);
        if (
          started.result &&
          !browserTerminalRunsRef.current.has(started.runId)
        ) {
          const terminal = started.result as {
            receipt?: { status?: string; summary?: string; code?: string };
          };
          await window.waypoint.addMessage(
            workspace.id,
            chatId,
            "system",
            `Browser ${terminal.receipt?.status ?? "failed"} · ${terminal.receipt?.summary ?? terminal.receipt?.code ?? "No result"}`,
            [],
          );
          setActiveBrowserRun(undefined);
          await refresh();
        }
        return;
      }
      const messageId = await window.waypoint.addMessage(
        workspace.id,
        chatId,
        "user",
        prompt,
        attachmentIds,
      );
      if (voiceTurn !== undefined && voiceRunRef.current?.turn === voiceTurn)
        voiceRunRef.current.sourceMessageId = messageId;
      if (cli === "openrouter") {
        const hosted = await window.waypoint.runOpenRouterChat({
          workspaceId: workspace.id,
          chatId,
          sourceMessageId: messageId,
          prompt,
          role: "everyday",
          securityProfileId: profile,
          attachmentIds,
          reasoningEffort:
            chatThinking[
              queuedHasImage
                ? "openrouterAttachment"
                : "openrouterEveryday"
            ] || undefined,
        });
        let exactRunId: string, runKind: "hosted" | "local";
        if (hosted.fallbackProvider) {
          const fallback = await window.waypoint.runChat(
            workspace.id,
            chatId,
            messageId,
            hosted.fallbackProvider,
            profile,
            prompt,
            subscriptionFallbackModel(hosted.fallbackProvider, chatModels),
            undefined,
            attachmentIds,
            undefined,
            chatThinking[hosted.fallbackProvider] || undefined,
          );
          exactRunId = fallback.runId;
          runKind = "local";
          setNotice(
            hosted.reason ??
              `Hosted cap reached; ${hosted.fallbackProvider} subscription fallback started.`,
          );
        } else {
          if (typeof hosted.runId !== "string")
            throw new Error(
              "Hosted voice run did not return an execution identity.",
            );
          exactRunId = hosted.runId;
          runKind = "hosted";
          setNotice(
            attachmentIds.length
              ? `OpenRouter ${hosted.model} is responding with ${attachmentIds.length} locally prepared attachment${attachmentIds.length === 1 ? "" : "s"} within the reserved cap…`
              : `OpenRouter ${hosted.model} is responding within the reserved per-request cap…`,
          );
        }
        if (voiceTurn !== undefined) {
          if (voiceTurn !== voiceTurnRef.current)
            await cancelLateVoiceRun(
              runKind,
              workspace.id,
              exactRunId,
              window.waypoint,
            );
          else if (voiceRunRef.current?.turn === voiceTurn)
            voiceRunRef.current.runId = exactRunId;
        }
        form.reset();
        await refresh();
        return;
      }
      const started = await window.waypoint.runChat(
        workspace.id,
        chatId,
        messageId,
        cli,
        profile,
        prompt,
        model,
        undefined,
        attachmentIds,
        undefined,
        chatThinking[cli] || undefined,
      );
      if (voiceTurn !== undefined && voiceRunRef.current?.turn === voiceTurn)
        voiceRunRef.current.runId = started.runId;
      if (voiceTurn !== undefined && voiceTurn !== voiceTurnRef.current)
        await cancelRun(started.runId);
      form.reset();
      const unsupported = started.attachmentDelivery.unsupported;
      setNotice(
        unsupported.length
          ? `${unsupported.length} attachment${unsupported.length === 1 ? " remains" : "s remain"} local because ${cli} cannot accept the file type.`
          : `${cli} is responding…`,
      );
      await refresh();
    } catch (reason) {
      if (voiceTurn !== undefined && voiceRunRef.current?.turn === voiceTurn) {
        setVoiceSessionActive(false);
        voiceStateRef.current = "off";
        setVoiceState("off");
        setVoicePartial("");
        voiceRunRef.current = undefined;
      }
      showError(reason);
      await refresh().catch(showError);
      setAttachments(
        await window.waypoint
          .listChatAttachments(workspace.id, chatId)
          .catch(() => []),
      );
    }
  }
  async function retryRun(run: ExecutionRunView) {
    if (!workspace || !selectedChat) return;
    const source = selectedChat.messages.find(
      (message) =>
        message.id === String(run.sourceMessageId ?? "") &&
        message.role === "user",
    );
    if (!source) {
      setError(
        "This older run has no exact source message and cannot be retried safely.",
      );
      return;
    }
    const ids = attachments
      .filter((item) => item.ownerId === source.id)
      .map((item) => item.id);
    try {
      await window.waypoint.runChat(
        workspace.id,
        selectedChat.id,
        source.id,
        String(run.cli) as "codex" | "claude" | "grok",
        String(run.securityProfileId),
        source.body,
        run.model ? String(run.model) : undefined,
        undefined,
        ids,
        undefined,
        chatThinking[String(run.cli) as "codex" | "claude" | "grok"] ||
          undefined,
      );
      setNotice("Retry started.");
      await refresh();
    } catch (reason) {
      showError(reason);
      await refresh().catch(showError);
    }
  }
  async function cancelRun(id: string) {
    try {
      const run = runs.find((item) => item.id === id);
      if (run?.cli === "openrouter")
        await window.waypoint.cancelOpenRouterRun(workspace!.id, id);
      else await window.waypoint.cancelExecution(id);
      setNotice(
        run?.cli === "openrouter"
          ? "Stopping the hosted request…"
          : "Stopping the local CLI…",
      );
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  function executionHistory(run: ExecutionRunView) {
    const events = uniqueExecutionEvents(run),
      toolEvents = events.filter((event) =>
        [
          "tool",
          "agent",
          "diagnostic",
          "provider",
          "progress",
          "terminal",
          "policy",
        ].includes(String(event.type)),
      ),
      text = executionAnswerText({ ...run, events });
    return (
      <Fragment key={`execution-${String(run.id)}`}>
        <details className={`execution-timeline ${String(run.status)}`}>
          <summary>
            <span className="status-dot" />
            <strong>
              {String(run.cli)} execution ·{" "}
              {String(run.status).replace("_", " ")}
            </strong>
            <small>
              {`${String(run.profileName ?? "Unknown authority profile")}${run.model ? ` · ${String(run.model)}` : ""} · `}
              {toolEvents.length
                ? `${toolEvents.length} structured event${toolEvents.length === 1 ? "" : "s"}`
                : "No provider tool events exposed"}
            </small>
            <span className="execution-chevron" aria-hidden="true" />
          </summary>
          <div className="execution-timeline-body">
            {!!toolEvents.length && (
              <ol>
                {toolEvents.map((event, index) => (
                  <li
                    key={`${String(run.id)}-${String(event.sequence ?? index)}`}
                  >
                    <b>
                      {event.type === "tool"
                        ? String(event.name ?? "Tool action")
                        : event.type === "agent"
                          ? String(event.name ?? "Agent event")
                          : String(event.type ?? "Provider status")}
                    </b>
                    {typeof event.text === "string" && (
                      <span>{event.text.slice(0, 1000)}</span>
                    )}
                    <small>
                      {event.createdAt
                        ? new Date(String(event.createdAt)).toLocaleTimeString()
                        : ""}
                    </small>
                  </li>
                ))}
              </ol>
            )}
            {!toolEvents.length && (
              <p>
                This provider did not expose an internal tool event for this
                run. Waypoint does not infer or invent one.
              </p>
            )}
          </div>
        </details>
        {run.status === "running" && text && (
          <article
            className="chat-message assistant execution-live-answer"
            aria-live="polite"
          >
            <div className="message-role">
              <img
                className="assistant-mark"
                src={waypointMark}
                alt="Waypoint"
              />
            </div>
            <div className="message-content">
              <ChatBody body={text} />
              <small className="execution-live-label">Still working…</small>
            </div>
          </article>
        )}
        {run.status !== "completed" && (
          <article className={`run-strip ${String(run.status)}`}>
            <div>
              <span className="status-dot" />
              <strong>
                {run.status === "running"
                  ? `${run.cli} is responding`
                  : String(run.status).replace("_", " ")}
              </strong>
              {failureAdvice(run) && <small>{failureAdvice(run)}</small>}
            </div>
            <div>
              {run.status === "running" && (
                <button onClick={() => void cancelRun(String(run.id))}>
                  Stop
                </button>
              )}
              {["failed", "timed_out", "canceled"].includes(
                String(run.status),
              ) && <button onClick={() => void retryRun(run)}>Retry</button>}
            </div>
          </article>
        )}
      </Fragment>
    );
  }
  async function delegateTask() {
    if (!workspace || !selectedChat) return;
    const parent = runs.find(
      (item) =>
        item.chatId === selectedChat.id &&
        Number(item.depth) === 0 &&
        ["claude", "grok"].includes(String(item.cli)) &&
        item.status === "completed" &&
        Array.isArray(item.events) &&
        item.events.some(
          (event) =>
            event &&
            typeof event === "object" &&
            (event as Record<string, unknown>).type === "text" &&
            String((event as Record<string, unknown>).text ?? "").trim(),
        ) &&
        !runs.some((child) => child.parentExecutionId === item.id),
    );
    if (!parent) {
      setError(
        "No completed Claude or Grok result has an unused child-task budget. Codex child tasks remain unavailable until a reviewed no-tool mode exists.",
      );
      return;
    }
    const type = (
      await promptModal({
        title: "Child task type",
        message: "Task type: analyze, summarize, or critique.",
        defaultValue: "critique",
        okLabel: "Continue",
      })
    )?.trim() as "analyze" | "summarize" | "critique" | undefined;
    if (!type) return;
    const instruction = (
      await promptModal({
        title: "Bounded child instruction",
        defaultValue:
          "Critique the prior answer for correctness and missing risks.",
        multiline: true,
        okLabel: "Start child task",
      })
    )?.trim();
    if (!instruction) return;
    const source = selectedChat.messages.find(
      (item) => item.id === String(parent.sourceMessageId),
    );
    if (!source) {
      setError("The parent source message is unavailable.");
      return;
    }
    try {
      await window.waypoint.runChat(
        workspace.id,
        selectedChat.id,
        source.id,
        String(parent.cli) as "claude" | "grok",
        String(parent.securityProfileId),
        instruction,
        parent.model ? String(parent.model) : undefined,
        String(parent.id),
        [],
        type,
      );
      setNotice(
        `${type} child task started with the parent provider and authority profile; Waypoint applies no AI time or output cap.`,
      );
      await refresh();
    } catch (reason) {
      showError(reason);
      await refresh().catch(showError);
    }
  }
  async function remove(kind: "document" | "chat" | "memory", id: string) {
    if (
      !workspace ||
      !(await confirmModal({
        title: `Delete this ${kind}?`,
        message: `Delete this ${kind} and its owned local data? This cannot be undone.`,
        okLabel: "Permanently delete",
        danger: true,
      }))
    )
      return;
    try {
      await window.waypoint.deleteObject(workspace.id, kind, id);
      if (kind === "chat") closeTab(`chat:${id}`, "close");
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function saveMessageToKnowledge(messageId: string) {
    if (!workspace) return;
    try {
      await window.waypoint.captureMessageAsDocument(workspace.id, messageId);
      setNotice("Saved to local knowledge.");
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function editDocument(item: Document) {
    if (!workspace) return;
    const title = await promptModal({
      title: "Note title",
      defaultValue: item.title,
      okLabel: "Continue",
    });
    if (title === null) return;
    const body = await promptModal({
      title: "Note text",
      defaultValue: item.body,
      multiline: true,
      okLabel: "Save note",
    });
    if (body === null) return;
    try {
      await window.waypoint.updateDocument(workspace.id, item.id, title, body);
      setNotice("Note updated locally.");
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function scanSuggestions() {
    if (!workspace) return;
    try {
      const result = await window.waypoint.scanMemorySuggestions(
        workspace.id,
        selectedChatId,
      );
      setNotice(
        result.created
          ? `${result.created} reviewable suggestion${result.created === 1 ? "" : "s"} found locally.`
          : "No new explicit suggestions found.",
      );
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function resolveSuggestion(
    item: MemorySuggestion,
    action: "accept" | "reject",
    edit = false,
  ) {
    if (!workspace) return;
    let title = item.title,
      body = item.body;
    if (edit) {
      const nextTitle = await promptModal({
        title: "Suggestion title",
        defaultValue: title,
        okLabel: "Continue",
      });
      if (nextTitle === null) return;
      const nextBody = await promptModal({
        title: "Suggestion text",
        defaultValue: body,
        multiline: true,
        okLabel: "Save suggestion",
      });
      if (nextBody === null) return;
      title = nextTitle;
      body = nextBody;
    }
    try {
      await window.waypoint.resolveMemorySuggestion(
        workspace.id,
        item.id,
        action,
        ...(action === "accept" ? ([title, body] as const) : []),
      );
      setNotice(
        action === "accept"
          ? "Saved with source provenance."
          : "Suggestion rejected; no memory was created.",
      );
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function toggleCommitment(item: Commitment) {
    if (!workspace) return;
    try {
      await window.waypoint.setCommitmentCompleted(
        workspace.id,
        item.id,
        item.status === "open",
      );
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function openBriefing() {
    if (!workspace) return;
    try {
      setBriefing(
        await window.waypoint.composeDailyBriefing(
          workspace.id,
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        ),
      );
      setSidebarOpen(false);
      openViewTab("briefing");
    } catch (reason) {
      showError(reason);
    }
  }
  async function dismissBriefing(item: Briefing["items"][number]) {
    if (!workspace || !briefing) return;
    try {
      await window.waypoint.dismissBriefingItem(
        workspace.id,
        item.id,
        item.kind,
        briefing.localDay,
      );
      setBriefing(
        await window.waypoint.composeDailyBriefing(
          workspace.id,
          briefing.timezone,
        ),
      );
    } catch (reason) {
      showError(reason);
    }
  }
  async function openRules() {
    if (!workspace) return;
    try {
      const [suggested, rules, graph] = await Promise.all([
        window.waypoint.listRuleSuggestions(workspace.id),
        window.waypoint.listLearnedRules(workspace.id),
        window.waypoint.graph(workspace.id),
      ]);
      setRuleSuggestions(suggested);
      setLearnedRules(rules);
      setKnowledgeGraph(graph);
      setSidebarOpen(false);
      openViewTab("rules");
    } catch (reason) {
      showError(reason);
    }
  }
  async function scanRules() {
    if (!workspace) return;
    try {
      const result = await window.waypoint.scanRuleSuggestions(workspace.id);
      setNotice(
        result.created
          ? `${result.created} repeated directive${result.created === 1 ? "" : "s"} ready for review.`
          : "No new repeated directives found.",
      );
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function dryRunRule(item: RuleSuggestion) {
    if (!workspace) return;
    try {
      const result = await window.waypoint.dryRunRuleSuggestion(
        workspace.id,
        item.id,
      );
      setNotice(
        `Dry run matched ${result.matchCount} current source messages; nothing was changed.`,
      );
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function resolveRule(
    item: RuleSuggestion,
    action: "approve" | "reject",
  ) {
    if (!workspace) return;
    try {
      await window.waypoint.resolveRuleSuggestion(
        workspace.id,
        item.id,
        action,
      );
      setNotice(
        action === "approve"
          ? "Advisory workspace rule approved."
          : "Rule suggestion rejected.",
      );
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function toggleRule(item: LearnedRule) {
    if (!workspace) return;
    try {
      await window.waypoint.setLearnedRuleEnabled(
        workspace.id,
        item.id,
        !item.enabled,
      );
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function revertRule(item: LearnedRule) {
    if (!workspace) return;
    try {
      await window.waypoint.revertLearnedRule(workspace.id, item.id);
      await openRules();
    } catch (reason) {
      showError(reason);
    }
  }
  async function runHealth() {
    if (!workspace) return;
    setChecking(true);
    try {
      setDiagnostics(await window.waypoint.diagnostics(workspace.id));
    } catch (reason) {
      showError(reason);
    } finally {
      setChecking(false);
    }
  }
  async function exportWorkspace() {
    if (!workspace) return;
    if (
      !(await confirmModal({
        title: "Waypoint backups are plaintext",
        message:
          "Choose a protected location. Deleting content in Waypoint does not delete backup copies.",
        okLabel: "Create plaintext backup",
      }))
    )
      return;
    try {
      const result = await window.waypoint.exportWorkspace(workspace.id);
      if (!result.canceled)
        setNotice(
          "Protected-location reminder shown; backup saved and verified.",
        );
    } catch (reason) {
      showError(reason);
    }
  }
  async function restoreWorkspace() {
    try {
      const result = await window.waypoint.restoreWorkspace();
      if (result.workspace) {
        setWorkspaces((current) => [...current, result.workspace!]);
        await selectWorkspace(result.workspace);
      }
    } catch (reason) {
      showError(reason);
    }
  }
  async function verifyBackup() {
    try {
      const result = await window.waypoint.verifyBackup();
      if (result.canceled) return;
      if (result.status === "passed")
        setNotice(
          `${result.fileName} passed integrity and format checks (${result.totalObjects} portable objects).`,
        );
      else setError(`${result.code}: ${result.remediation}`);
    } catch (reason) {
      showError(reason);
    }
  }
  async function drillBackup() {
    try {
      const result = await window.waypoint.drillBackup();
      if (result.canceled) return;
      if (result.status === "passed" && result.drill)
        setNotice(
          `${result.fileName} restored successfully in isolation; temporary drill data was removed.`,
        );
      else setError(`${result.code}: ${result.remediation}`);
    } catch (reason) {
      showError(reason);
    }
  }
  async function initializeSync() {
    if (!workspace) return;
    if (
      !(await confirmModal({
        title: "Set up this device as the first sync owner?",
        message:
          "This creates local protected keys. Next, host directly on this device or explicitly configure the optional hosted relay.",
        okLabel: "Create protected sync identity",
      }))
    )
      return;
    try {
      const result = await window.waypoint.initializeDesktopSync(workspace.id);
      if (result.bootstrap) {
        setBootstrapBundle(JSON.stringify(result.bootstrap));
        setNotice(
          "Protected owner identity created. Host on this device for direct peer sync, or explicitly configure the optional hosted relay.",
        );
      }
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function invitePeer() {
    if (!workspace || inviteBusy || !desktopSync?.configured) return;
    const target = workspace,
      scopeCurrent = () =>
        attachmentContextRef.current.workspaceId === target.id;
    let startedHost = false;
    setInviteBusy(true);
    try {
      let current = await window.waypoint.desktopSyncStatus(target.id);
      if (!scopeCurrent()) return;
      if (
        current.transportMode === "desktop-host" &&
        !current.peerHost?.running
      ) {
        const confirmed = await confirmModal({
          title: "Start this device and create an invitation?",
          message:
            "Direct enrollment needs this Waypoint app awake and hosting on the local network. Waypoint will start the desktop host, then create a one-use invitation valid for 15 minutes.",
          okLabel: "Start host & invite",
        });
        if (!confirmed) return;
        if (!scopeCurrent()) return;
        const started = await window.waypoint.startDesktopSyncHost(target.id);
        startedHost = started.running === true;
        if (!scopeCurrent()) return;
        current = await window.waypoint.desktopSyncStatus(target.id);
        if (!scopeCurrent()) return;
        if (!current.peerHost?.running)
          throw new Error("The desktop sync host did not start. Try again.");
      }
      if (!scopeCurrent()) return;
      const result = await window.waypoint.createSyncInvitation(target.id);
      if (!scopeCurrent()) return;
      setSyncInvitation(result);
      try {
        await navigator.clipboard.writeText(result.token);
        setNotice("One-use invitation created and copied.");
      } catch {
        setNotice(
          "One-use invitation created. Copy it from the visible invitation card.",
        );
      }
    } catch (reason) {
      showError(reason);
    } finally {
      if (!scopeCurrent() && startedHost)
        await window.waypoint.stopDesktopSyncHost(target.id).catch(showError);
      setInviteBusy(false);
      if (scopeCurrent()) {
        await refresh(target).catch(showError);
      }
    }
  }
  async function joinSync() {
    const token = await promptModal({
      title: "Join workspace sync",
      message: "Paste the one-use Waypoint enrollment token.",
      placeholder: "Enrollment token",
      okLabel: "Request enrollment",
    });
    if (!token) return;
    try {
      const result = await window.waypoint.submitSyncEnrollment(token);
      setNotice(
        "Enrollment requested. After the owner approves, choose Complete enrollment.",
      );
      if (workspaces.some((item) => item.id === result.workspaceId))
        await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function completeSync() {
    if (!workspace) return;
    try {
      await window.waypoint.completeSyncEnrollment(workspace.id);
      setNotice(
        "This device is enrolled and the workspace key is protected locally.",
      );
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }
  async function approvePeer(requestId: string) {
    if (!workspace) return;
    if (
      !(await confirmModal({
        title: "Approve this device for workspace sync?",
        message:
          "The device will receive a wrapped copy of the workspace key and request a fresh encrypted workspace snapshot after enrollment.",
        okLabel: "Approve device",
      }))
    )
      return;
    try {
      const result = await window.waypoint.approveSyncEnrollment(
        workspace.id,
        requestId,
      );
      if (!result.canceled) {
        setNotice("Device approved.");
        await refresh();
      }
    } catch (reason) {
      showError(reason);
    }
  }
  async function revokePeer(deviceId: string) {
    if (!workspace) return;
    if (
      !(await confirmModal({
        title: "Revoke this device?",
        message:
          "The device will lose relay access immediately. Waypoint will rotate the workspace key for remaining devices.",
        okLabel: "Revoke and rotate",
        danger: true,
      }))
    )
      return;
    try {
      const result = await window.waypoint.revokeSyncDevice(
        workspace.id,
        deviceId,
      );
      if (!result.canceled) {
        setNotice(
          `Device revoked; key epoch ${result.rotation?.keyEpoch} is active.`,
        );
        await refresh();
      }
    } catch (reason) {
      showError(reason);
    }
  }
  async function toggleDeviceWorker() {
    if (!workspace || !deviceControl) return;
    if (
      !(await confirmModal({
        title: "Change trusted device execution policy?",
        message:
          "Worker enablement, failover, capability, preference, and execution limits are security-critical. Jobs remain limited to the capabilities shown in Waypoint.",
        okLabel: "Apply device policy",
      }))
    )
      return;
    try {
      const result = await window.waypoint.updateDeviceControl(workspace.id, {
        ...deviceControl.policy,
        enabled: !deviceControl.policy.enabled,
      });
      if (!result.canceled) {
        setNotice(
          result.policy.enabled
            ? "This device now accepts the listed trusted commands."
            : "This device worker is disabled.",
        );
        await refresh();
      }
    } catch (reason) {
      showError(reason);
    }
  }
  async function dispatchDeviceSummary(targetDeviceId: string) {
    if (!workspace) return;
    try {
      await window.waypoint.dispatchDeviceCommand(
        workspace.id,
        targetDeviceId,
        "Return a bounded workspace summary",
        crypto.randomUUID(),
      );
      setNotice("Encrypted command queued for the selected trusted device.");
      await window.waypoint.syncNow(workspace.id);
      await refresh();
    } catch (reason) {
      showError(reason);
    }
  }

  if (!workspace)
    return (
      <main className="onboarding">
        <ModalDialogHost />
        <img className="brand-mark" src={waypointMark} alt="Waypoint" />
        <p className="kicker">Private by default</p>
        <h1>
          Your thinking,
          <br />
          close at hand.
        </h1>
        <p>
          Waypoint keeps conversations and knowledge on this computer and uses
          only the signed-in CLI you choose.
        </p>
        <form onSubmit={createWorkspace}>
          <label>
            Workspace name
            <input
              name="name"
              required
              maxLength={120}
              autoFocus
              placeholder="Personal"
            />
          </label>
          <button>Create workspace</button>
        </form>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
      </main>
    );

  const selectedChat = chats.find((chat) => chat.id === selectedChatId),
    chatRuns = uniqueChatRuns(
      runs.filter((run) => run.chatId === selectedChatId) as ExecutionRunView[],
    ),
    queued = attachments.filter((item) => item.ownerId === selectedChatId),
    queuedHasImage = queued.some((item) => item.mediaType.startsWith("image/")),
    chatAutomationProposals = automationProposals.filter(
      (item) =>
        item.chatId === selectedChatId && item.question?.status === "pending",
    ),
    selectedSecurityProfile = profiles.find(
      (item) => item.id === selectedProfileId,
    ),
    selectedProviderSession = providerSessions.find(
      (item) => item.chatId === selectedChatId && item.provider === chatCli,
    ),
    pendingChatProviderRequests = providerRequests.filter(
      (item) => item.chatId === selectedChatId && item.status === "pending",
    ),
    historyGroups = groupChatHistory(chats, historyQuery, historySort),
    selectedComposerModel =
      chatCli === "openrouter"
        ? ((queuedHasImage
            ? openRouter?.settings.attachmentModel
            : openRouter?.settings.everydayModel) ?? "")
        : chatModels[chatCli],
    composerModelChoices =
      chatCli === "openrouter"
        ? (queuedHasImage
            ? openRouterImageModelChoices(selectedComposerModel)
            : openRouterModelChoices(selectedComposerModel)
          ).map((item) => ({
            id: item.id,
            label: `${item.name} — ${item.id}${item.legacy ? " (saved legacy/custom)" : ""}`,
            disabled: item.legacy && queuedHasImage,
          }))
        : withLegacyModel(
            cliModels.find((item) => item.provider === chatCli)?.models ?? [
              { id: "", label: `${chatCli} default (CLI selected)` },
            ],
            selectedComposerModel,
          ),
    codexModelChoices = withLegacyModel(
      cliModels.find((item) => item.provider === "codex")?.models ?? [
        { id: "", label: "Codex default (CLI selected)" },
      ],
      chatModels.codex,
    ),
    claudeModelChoices = withLegacyModel(
      cliModels.find((item) => item.provider === "claude")?.models ?? [
        { id: "", label: "Claude default (CLI selected)" },
      ],
      chatModels.claude,
    ),
    grokModelChoices = withLegacyModel(
      cliModels.find((item) => item.provider === "grok")?.models ?? [
        { id: "", label: "Grok default (CLI selected)" },
      ],
      chatModels.grok,
    ),
    selectedComposerThinking =
      chatCli === "openrouter"
        ? openRouterModelThinking(selectedComposerModel)
        : cliModels
            .find((item) => item.provider === chatCli)
            ?.models.find((item) => item.id === selectedComposerModel)
            ?.thinking,
    selectedComposerThinkingLane: ThinkingLane =
      chatCli === "openrouter"
        ? queuedHasImage
          ? "openrouterAttachment"
          : "openrouterEveryday"
        : chatCli,
    grokCatalog = cliModels.find((item) => item.provider === "grok"),
    openRouterPresentation = openRouter
      ? providerCapabilityPresentation(
          openRouter.capability.state,
          openRouter.capability.health,
        )
      : undefined,
    hostedSettings = openRouterSettingsDraft ?? openRouter?.settings,
    officeProviderOptions: OfficeProviderOption[] = [
      ...(["codex", "claude", "grok"] as const).map((provider) => {
        const capability = capabilities.find((item) => item.name === provider),
          grokReady =
            provider !== "grok" ||
            cliModels.some(
              (catalog) => catalog.provider === "grok" && catalog.ready,
            ),
          available =
            Boolean(capability?.available) &&
            capability?.compatible !== false &&
            grokReady,
          model = chatModels[provider] || undefined;
        return {
          id: provider,
          label: provider[0].toUpperCase() + provider.slice(1),
          available,
          availabilityReason: !capability?.available
            ? "not installed"
            : capability.compatible === false
              ? (capability.compatibilityError ?? "incompatible version")
              : !grokReady
                ? "sign in required"
                : undefined,
          model,
          modelLabel: model || `${provider} CLI default`,
        };
      }),
      {
        id: "openrouter",
        label: "OpenRouter",
        available: Boolean(openRouter?.capability.available),
        availabilityReason:
          openRouter?.capability.reason ?? "configure hosted requests in Settings",
        model: openRouter?.settings.everydayModel || undefined,
        modelLabel:
          openRouter?.settings.everydayModel || "OpenRouter everyday default",
      },
    ];
  return (
    <div className="app-frame">
      <ModalDialogHost />
      <button
        className="mobile-menu icon-button"
        aria-label="Open conversations"
        onClick={() => setSidebarOpen(true)}
      >
        ☰
      </button>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close conversations"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        ref={sidebarOpen ? overlayRef : undefined}
        className={`left-sidebar ${sidebarOpen ? "open" : ""}`}
        aria-label="Primary navigation"
        role={sidebarOpen ? "dialog" : undefined}
        aria-modal={sidebarOpen || undefined}
      >
        <div className="wordmark">
          <img src={waypointMark} alt="" />
          <strong>Waypoint</strong>
        </div>
        <button className="new-chat" onClick={() => void beginNewChat()}>
          <span>＋</span> New chat <kbd>{shortcutModifier} N</kbd>
        </button>
        <div className="history-tools">
          <label>
            <span className="sr-only">Search conversations</span>
            <b>⌕</b>
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="Search chats"
            />
          </label>
          <select
            value={historySort}
            onChange={(event) =>
              setHistorySort(event.target.value as HistorySort)
            }
            aria-label="Sort conversations"
          >
            <option value="recent">Recent</option>
            <option value="title">A–Z</option>
          </select>
        </div>
        <nav className="conversation-list" aria-label="Conversations">
          {historyGroups.map((group) => (
            <section
              key={group.label}
              aria-labelledby={`history-${group.label.replaceAll(" ", "-")}`}
            >
              <h2 id={`history-${group.label.replaceAll(" ", "-")}`}>
                {group.label}
              </h2>
              {group.items.map((item) => {
                const chat = chats.find(
                  (candidate) => candidate.id === item.id,
                )!;
                return (
                  <div
                    className={`conversation-row ${activeMainTabId === `chat:${chat.id}` ? "active" : ""}`}
                    key={chat.id}
                  >
                    <button
                      className="conversation-select"
                      aria-current={
                        activeMainTabId === `chat:${chat.id}`
                          ? "page"
                          : undefined
                      }
                      onClick={() => {
                        openChatTab(chat.id);
                      }}
                    >
                      <span>{chat.title}</span>
                      <small>
                        {chat.messages.at(-1)?.body || "No messages yet"}
                      </small>
                    </button>
                    <button
                      className="conversation-rename"
                      aria-label={`Rename ${chat.title}`}
                      title="Rename conversation"
                      onClick={() => {
                        if (!workspace) return;
                        void promptModal({
                          title: "Rename conversation",
                          defaultValue: chat.title,
                          okLabel: "Rename",
                        })
                          .then((title) => {
                            if (title?.trim())
                              return window.waypoint
                                .renameChat(workspace.id, chat.id, title)
                                .then(() => refresh());
                          })
                          .catch(showError);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="conversation-delete"
                      aria-label={`Delete ${chat.title}`}
                      onClick={() => void remove("chat", chat.id)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
          {!historyGroups.length && (
            <p className="sidebar-empty">
              {historyQuery
                ? "No matching conversations."
                : "Your conversations will live here."}
            </p>
          )}
        </nav>
        <nav className="utility-nav" aria-label="Workspace tools">
          <button
            onClick={() => {
              openViewTab("office");
            }}
          >
            <span>▦</span> Command Center <kbd>Experimental</kbd>
          </button>
          <button onClick={() => void openBriefing()}>
            <span>☀</span> Briefing
          </button>
          <button
            onClick={() => {
              openViewTab("knowledge");
            }}
          >
            <span>{knowledgeIcon}</span> Knowledge{" "}
            <kbd>{shortcutModifier} K</kbd>
          </button>
          <button onClick={() => void openRules()}>
            <span>◇</span> Graph &amp; rules
          </button>
          <button onClick={() => void openReflection().catch(showError)}>
            <span>✦</span> Reflect
          </button>
          <button onClick={() => void openMeetings().catch(showError)}>
            <span>◉</span> Meetings
          </button>
          <button onClick={() => void openAutomations().catch(showError)}>
            <span>↻</span> Automations
          </button>
          <button
            onClick={() => {
              openViewTab("activity");
            }}
          >
            <span>↗</span> Activity
          </button>
          <button
            onClick={() => {
              openViewTab("health");
            }}
          >
            <span>♡</span> Health
          </button>
          <button
            onClick={() => {
              openViewTab("settings");
            }}
          >
            <span>⚙</span> Settings
          </button>
        </nav>
        <div className="workspace-switcher">
          <label>
            Workspace
            <select
              value={workspace.id}
              disabled={Boolean(recordingMeetingId)}
              aria-label={
                recordingMeetingId
                  ? "Workspace switching is disabled while recording"
                  : "Workspace"
              }
              onChange={(event) => {
                const next = workspaces.find(
                  (item) => item.id === event.target.value,
                );
                if (next) void selectWorkspace(next);
              }}
            >
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <small>
            <i /> Local only
          </small>
          <div className="workspace-actions">
            <button
              type="button"
              onClick={() => {
                setWorkspaceNameDraft("");
                setWorkspaceDialog("create");
              }}
              aria-label="Create a new workspace"
            >
              + New workspace
            </button>
            <button
              type="button"
              className="danger"
              disabled={
                workspaces.length <= 1 ||
                Boolean(recordingMeetingId) ||
                voiceSessionActive ||
                voiceState !== "off"
              }
              onClick={() => setWorkspaceDialog("delete")}
              aria-label={`Delete workspace ${workspace.name}`}
            >
              Delete
            </button>
          </div>
        </div>
      </aside>

      {workspaceDialog && (
        <div className="workspace-dialog-scrim" role="presentation">
          <section
            ref={workspaceDialogRef}
            className="workspace-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-dialog-title"
          >
            <h2 id="workspace-dialog-title">
              {workspaceDialog === "create"
                ? "Create workspace"
                : `Delete “${workspace.name}”?`}
            </h2>
            {workspaceDialog === "create" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void addWorkspace(workspaceNameDraft);
                }}
              >
                <label>
                  Workspace name
                  <input
                    autoFocus
                    required
                    maxLength={120}
                    value={workspaceNameDraft}
                    onChange={(event) =>
                      setWorkspaceNameDraft(event.target.value)
                    }
                  />
                </label>
                <div>
                  <button
                    type="button"
                    onClick={() => setWorkspaceDialog(undefined)}
                  >
                    Cancel
                  </button>
                  <button type="submit">Create workspace</button>
                </div>
              </form>
            ) : (
              <>
                <p>
                  Permanently delete this workspace and all of its chats,
                  knowledge, attachments, settings, and history? This cannot be
                  undone.
                </p>
                <div>
                  <button
                    autoFocus
                    type="button"
                    onClick={() => setWorkspaceDialog(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void removeWorkspace()}
                  >
                    Permanently delete
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <main className="chat-main">
        <nav className="main-tabs" aria-label="Open workspace tabs">
          <div className="main-tabs-scroll">
            {mainTabs.map((tab, index) => {
              const title =
                  tab.kind === "chat"
                    ? chats.find((chat) => chat.id === tab.chatId)?.title ||
                      "Conversation"
                    : workspaceViewTitles[tab.view],
                running =
                  tab.kind === "chat" &&
                  runs.some(
                    (run) =>
                      run.chatId === tab.chatId &&
                      (run.status === "queued" || run.status === "running"),
                  );
              return (
                <div
                  className={`main-tab ${tab.id === activeMainTabId ? "active" : ""}`}
                  key={tab.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setTabMenu({
                      tabId: tab.id,
                      x: Math.min(event.clientX, window.innerWidth - 220),
                      y: Math.min(event.clientY, window.innerHeight - 190),
                    });
                  }}
                >
                  <button
                    className="main-tab-select"
                    aria-current={
                      tab.id === activeMainTabId ? "page" : undefined
                    }
                    onClick={() => activateMainTab(tab)}
                    title={title}
                  >
                    {running && (
                      <i className="main-tab-running" aria-label="Running" />
                    )}
                    <span>{title}</span>
                  </button>
                  <button
                    className="main-tab-close"
                    aria-label={`Close ${title}`}
                    title="Close tab"
                    onClick={() => closeTab(tab.id, "close")}
                  >
                    ×
                  </button>
                  {index < mainTabs.length - 1 && (
                    <span className="sr-only">Tab</span>
                  )}
                </div>
              );
            })}
          </div>
          {mainTabs.length > 0 && (
            <button
              className="main-tabs-menu-button"
              aria-label="Tab actions"
              title="Tab actions"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setTabMenu({
                  tabId: activeMainTabId || mainTabs[0].id,
                  x: Math.max(8, box.right - 208),
                  y: box.bottom + 5,
                });
              }}
            >
              ⋯
            </button>
          )}
        </nav>
        {activeMainTabId ? (
          <div
            className="chat-tab-content"
            aria-hidden={Boolean(drawer)}
            inert={drawer ? true : undefined}
          >
            <header className="chat-header">
              <button
                className="mobile-menu-inline icon-button"
                aria-label="Open conversations"
                onClick={() => setSidebarOpen(true)}
              >
                ☰
              </button>
              <div>
                <strong>{selectedChat?.title || "New conversation"}</strong>
                {selectedChat?.titleStatus === "running" && (
                  <small aria-live="polite">Naming chat…</small>
                )}
                <small>
                  {chatCli} ·{" "}
                  {chatCli === "openrouter"
                    ? "hosted · explicit cost policy"
                    : "local CLI"}
                </small>
              </div>
              {recordingMeetingId && (
                <div className="recording-global" role="status">
                  <button
                    aria-label="Open active meeting recording"
                    onClick={() => openViewTab("meetings")}
                  >
                    ● Recording {Math.floor(recordingSeconds / 60)}:
                    {String(recordingSeconds % 60).padStart(2, "0")}
                  </button>
                  <button
                    aria-label="Stop and save active meeting recording"
                    onClick={() => void stopMeeting().catch(showError)}
                  >
                    Stop
                  </button>
                </div>
              )}
              {activityCapture?.policy.enabled && (
                <div
                  className={`capture-global ${activityCapture.policy.paused || !activityCapture.readiness.available ? "paused" : "active"}`}
                  role="status"
                >
                  <button
                    aria-label="Open whole-device activity capture controls"
                    onClick={() => openViewTab("activity")}
                  >
                    {activityCapture.readiness.available &&
                    !activityCapture.policy.paused
                      ? "● Capturing"
                      : "Ⅱ Activity paused"}
                  </button>
                  <button
                    aria-label="Pause whole-device activity capture"
                    disabled={activityCapture.policy.paused}
                    onClick={() =>
                      void updateActivityCapture({ paused: true }).catch(
                        showError,
                      )
                    }
                  >
                    Pause
                  </button>
                </div>
              )}
              <div
                className="chat-header-actions"
                role="group"
                aria-label="Chat actions"
              >
                <button
                  className="knowledge-button"
                  aria-label="Capture screenshot"
                  onClick={() => setScreenCaptureOpen(true)}
                >
                  Capture
                </button>
                {selectedChat && (
                  <button
                    className="knowledge-button"
                    aria-label="Delegate task"
                    onClick={() => void delegateTask()}
                  >
                    Delegate task
                  </button>
                )}
                <button
                  className="knowledge-button"
                  aria-label="Open Waypoint In-App Browser"
                  onClick={() => openViewTab("browser")}
                >
                  Browser
                </button>
                <button
                  className="knowledge-button"
                  aria-label="Open knowledge"
                  onClick={() => openViewTab("knowledge")}
                >
                  Knowledge <span>{shortcutModifier} K</span>
                </button>
              </div>
            </header>
            {(error || notice) && (
              <div
                className={`toast ${error ? "error" : ""}`}
                role={error ? "alert" : "status"}
              >
                {error || notice}
                <button
                  aria-label="Dismiss"
                  onClick={() => {
                    setError("");
                    setNotice("");
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {selectedChat ? (
              <>
                <section
                  ref={transcriptRef}
                  className="transcript"
                  aria-label="Conversation"
                  aria-live="polite"
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    transcriptFollowingRef.current = shouldFollowChat(
                      element.scrollHeight,
                      element.scrollTop,
                      element.clientHeight,
                    );
                  }}
                >
                  {!selectedChat.messages.length && (
                    <div className="empty-chat">
                      <div className="compass">✦</div>
                      <h1>What are we working on?</h1>
                      <p>
                        Ask Waypoint to think, write, research your local
                        knowledge, or organize what matters.
                      </p>
                    </div>
                  )}
                  {chatRuns
                    .filter(
                      (run) =>
                        !selectedChat.messages.some(
                          (message) =>
                            message.id === String(run.sourceMessageId ?? ""),
                        ),
                    )
                    .map(executionHistory)}
                  {selectedChat.messages.map((message) => (
                    <Fragment key={message.id}>
                      <article className={`chat-message ${message.role}`}>
                        <div className="message-role">
                          {message.role === "assistant" ? (
                            <img
                              className="assistant-mark"
                              src={waypointMark}
                              alt="Waypoint"
                            />
                          ) : (
                            <span>
                              {message.role === "system" ? "Browser" : "You"}
                            </span>
                          )}
                        </div>
                        <div className="message-content">
                          {message.role === "assistant" ||
                          message.role === "system" ? (
                            <ChatBody body={message.body} />
                          ) : (
                            <p>{message.body}</p>
                          )}
                          {attachments.some(
                            (item) => item.ownerId === message.id,
                          ) && (
                            <div
                              className="sent-files"
                              aria-label="Message attachments"
                            >
                              {attachments
                                .filter((item) => item.ownerId === message.id)
                                .map((item) => (
                                  <ChatAttachmentPreview
                                    key={item.id}
                                    workspaceId={workspace.id}
                                    chatId={selectedChat.id}
                                    attachment={item}
                                    onOpen={showAttachmentViewer}
                                  />
                                ))}
                            </div>
                          )}
                          {message.role === "assistant" && (
                            <button
                              className="message-action"
                              onClick={() =>
                                void saveMessageToKnowledge(message.id)
                              }
                            >
                              ＋ Save to knowledge
                            </button>
                          )}
                        </div>
                      </article>
                      {message.role === "user" &&
                        runsForSourceMessage(chatRuns, message.id).map(
                          executionHistory,
                        )}
                    </Fragment>
                  ))}
                </section>
                <div className="composer-dock">
                  {chatAutomationProposals.map((proposal) => (
                    <section
                      className="automation-confirmation"
                      role="group"
                      aria-labelledby={`automation-question-${proposal.id}`}
                      key={proposal.id}
                    >
                      <div>
                        <small>
                          {proposal.definition.trigger.connectorId.replaceAll(
                            "_",
                            " ",
                          )}{" "}
                          · explicit approval required
                        </small>
                        <strong id={`automation-question-${proposal.id}`}>
                          {proposal.title}
                        </strong>
                        <p>{proposal.question?.prompt}</p>
                        <dl>
                          <div>
                            <dt>Trigger</dt>
                            <dd>
                              {proposal.definition.trigger.eventType} · filters{" "}
                              {Object.keys(proposal.definition.trigger.filters)
                                .length
                                ? JSON.stringify(
                                    proposal.definition.trigger.filters,
                                  )
                                : "none"}
                            </dd>
                          </div>
                          <div>
                            <dt>AI route</dt>
                            <dd>
                              {proposal.definition.action.provider}
                              {proposal.definition.action.model
                                ? ` · ${proposal.definition.action.model}`
                                : " · default model"}{" "}
                              · profile{" "}
                              {proposal.definition.action.securityProfileId} ·
                              runs until completion or cancellation
                            </dd>
                          </div>
                          <div>
                            <dt>Instruction</dt>
                            <dd>{proposal.definition.action.instruction}</dd>
                          </div>
                          <div>
                            <dt>Delivery</dt>
                            <dd>
                              {proposal.definition.delivery.reachability.replaceAll(
                                "_",
                                " ",
                              )}{" "}
                              ·{" "}
                              {proposal.definition.delivery.endpoint ??
                                "not configured"}{" "}
                              · channel{" "}
                              {proposal.definition.delivery.channelId ??
                                "not configured"}
                            </dd>
                          </div>
                          <div>
                            <dt>Provisioning</dt>
                            <dd>
                              {proposal.definition.provisioning.mode.replaceAll(
                                "_",
                                " ",
                              )}{" "}
                              ·{" "}
                              {[
                                proposal.definition.provisioning.organization,
                                proposal.definition.provisioning.project,
                                proposal.definition.provisioning
                                  .repositoryFullName ??
                                  proposal.definition.provisioning.repository,
                                proposal.definition.provisioning.targetBranch,
                              ]
                                .filter(Boolean)
                                .join(" / ") || "no provider target"}{" "}
                              · stable IDs{" "}
                              {[
                                proposal.definition.provisioning.projectId,
                                proposal.definition.provisioning.repositoryId,
                              ]
                                .filter(Boolean)
                                .join(" / ") || "not applicable"}
                              {proposal.definition.provisioning.commandPreview
                                ? ` · ${proposal.definition.provisioning.commandPreview}`
                                : ""}
                            </dd>
                          </div>
                          <div>
                            <dt>Approval digest</dt>
                            <dd>
                              <code>{proposal.proposalDigest}</code>
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div className="automation-confirmation-actions">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            void decideAutomationProposal(
                              proposal,
                              "reject",
                            ).catch(showError)
                          }
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void decideAutomationProposal(
                              proposal,
                              "approve",
                            ).catch(showError)
                          }
                        >
                          Approve and provision
                        </button>
                      </div>
                    </section>
                  ))}
                  {pendingChatProviderRequests.map((request) => (
                    <ProviderRequestCard
                      key={request.id}
                      request={request}
                      onDecision={async (status, decision) => {
                        try {
                          await decideProviderRequest(
                            request.id,
                            status,
                            decision,
                          );
                        } catch (error) {
                          showError(error);
                        }
                      }}
                    />
                  ))}
                  {browserActivity.length > 0 && (
                    <details
                      className="execution-timeline browser-chat-activity"
                      open={Boolean(activeBrowserRun)}
                    >
                      <summary>
                        <span className="status-dot" />
                        <strong>
                          Browser activity ·{" "}
                          {activeBrowserRun ? "running" : "latest result"}
                        </strong>
                        <small>
                          Redacted structured actions ·{" "}
                          {toolSettings?.browserAllowedDomains.length ?? 0}{" "}
                          allowed domains
                        </small>
                      </summary>
                      <ol>
                        {browserActivity.map((item) => (
                          <li key={`${item.runId}-${item.sequence}`}>
                            <b>{item.type}</b>
                            <span>{item.summary}</span>
                            <small>
                              {new Date(item.createdAt).toLocaleTimeString()}
                            </small>
                          </li>
                        ))}
                      </ol>
                      <div className="drawer-actions">
                        {activeBrowserRun && (
                          <button
                            type="button"
                            onClick={() =>
                              workspace &&
                              void window.waypoint.cancelTool(
                                workspace.id,
                                activeBrowserRun,
                              )
                            }
                          >
                            Cancel browser action
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            void stopAllBrowserTools().catch(showError)
                          }
                        >
                          Global stop
                        </button>
                      </div>
                    </details>
                  )}
                  <form
                    className="composer"
                    onSubmit={(event) => void runChat(event, selectedChat.id)}
                  >
                    {queued.length > 0 && (
                      <div
                        className="file-queue"
                        aria-label="Queued attachments"
                      >
                        {queued.map((item) => (
                          <ChatAttachmentPreview
                            key={item.id}
                            workspaceId={workspace.id}
                            chatId={selectedChat.id}
                            attachment={item}
                            queued
                            onOpen={showAttachmentViewer}
                            onRemove={() => void removeAttachment(item.id)}
                          />
                        ))}
                      </div>
                    )}
                    <textarea
                      ref={composerRef}
                      name="prompt"
                      required
                      rows={1}
                      placeholder="Message Waypoint"
                      aria-label="Message Waypoint"
                      onPaste={(event) => void pasteChatImages(event)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <div className="composer-controls">
                      <div>
                        <button
                          type="button"
                          className="attach"
                          disabled={attachmentBusy}
                          onClick={() => void chooseAttachments()}
                          aria-label="Attach files"
                        >
                          ＋
                        </button>
                        <button
                          type="button"
                          className={`voice-control ${voiceState !== "off" || voiceSessionActive ? "active" : ""}`}
                          aria-label={
                            voiceMode === "hands_free"
                              ? voiceSessionActive
                                ? "End hands-free voice session"
                                : "Start hands-free voice session"
                              : "Hold to talk"
                          }
                          title={
                            voiceMode === "hands_free"
                              ? voiceSessionActive
                                ? "End voice session"
                                : "Start hands-free voice"
                              : "Hold to talk"
                          }
                          aria-pressed={
                            voiceMode === "hands_free"
                              ? voiceSessionActive
                              : undefined
                          }
                          onClick={
                            voiceMode === "hands_free"
                              ? () => void toggleHandsFree()
                              : undefined
                          }
                          onPointerDown={
                            voiceMode === "push_to_talk"
                              ? (event) => {
                                  event.currentTarget.setPointerCapture(
                                    event.pointerId,
                                  );
                                  beginPushToTalk();
                                }
                              : undefined
                          }
                          onPointerUp={
                            voiceMode === "push_to_talk"
                              ? releasePushToTalk
                              : undefined
                          }
                          onPointerCancel={
                            voiceMode === "push_to_talk"
                              ? () => void stopVoiceMode()
                              : undefined
                          }
                          onKeyDown={
                            voiceMode === "push_to_talk"
                              ? (event) => {
                                  if (
                                    !event.repeat &&
                                    (event.key === " " || event.key === "Enter")
                                  ) {
                                    event.preventDefault();
                                    beginPushToTalk();
                                  }
                                }
                              : undefined
                          }
                          onKeyUp={
                            voiceMode === "push_to_talk"
                              ? (event) => {
                                  if (
                                    event.key === " " ||
                                    event.key === "Enter"
                                  ) {
                                    event.preventDefault();
                                    releasePushToTalk();
                                  }
                                }
                              : undefined
                          }
                        >
                          <span />
                          <span />
                          <span />
                        </button>
                        <select
                          className="provider-select"
                          name="cli"
                          value={chatCli}
                          onChange={(event) =>
                            setChatCli(
                              event.target.value as
                                "codex" | "claude" | "grok" | "openrouter",
                            )
                          }
                          aria-label="AI provider"
                        >
                          {capabilities.map((item) => (
                            <option
                              key={item.name}
                              value={item.name}
                              disabled={
                                !item.available ||
                                item.compatible === false ||
                                (item.name === "grok" &&
                                  !cliModels.some(
                                    (catalog) =>
                                      catalog.provider === "grok" &&
                                      catalog.ready,
                                  ))
                              }
                            >
                              {item.name}
                              {!item.available ? " · unavailable" : ""}
                              {item.name === "grok" &&
                              cliModels.some(
                                (catalog) =>
                                  catalog.provider === "grok" && !catalog.ready,
                              )
                                ? " · sign in required"
                                : ""}
                            </option>
                          ))}
                          <option
                            value="openrouter"
                            disabled={!openRouter?.capability.available}
                          >
                            OpenRouter
                            {openRouter?.capability.available
                              ? " · hosted cost"
                              : ` · ${openRouter?.capability.reason ?? "Open Settings to configure a protected key and activation."}`}
                          </option>
                        </select>
                        <select
                          className="profile-select"
                          name="profile"
                          value={selectedProfileId}
                          onChange={(event) =>
                            void selectSecurityProfile(event.target.value)
                          }
                          aria-label="Security profile"
                        >
                          {profiles.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                        <select
                          className="model-select"
                          name="model"
                          aria-label={`${chatCli}${chatCli === "openrouter" && queuedHasImage ? " image" : ""} model`}
                          value={selectedComposerModel}
                          onChange={(event) =>
                            void changeComposerModel(event.target.value).catch(
                              showError,
                            )
                          }
                        >
                          {composerModelChoices.map((model) => (
                            <option
                              value={model.id}
                              key={model.id || "default"}
                              disabled={Boolean(
                                "disabled" in model && model.disabled,
                              )}
                            >
                              {model.label}
                            </option>
                          ))}
                        </select>
                        <ThinkingSelect
                          compact
                          label={`${chatCli} thinking level`}
                          value={chatThinking[selectedComposerThinkingLane]}
                          supported={selectedComposerThinking?.supported ?? []}
                          defaultEffort={
                            selectedComposerThinking?.defaultEffort
                          }
                          onChange={(value) =>
                            void changeThinking(
                              selectedComposerThinkingLane,
                              value,
                            ).catch(showError)
                          }
                        />
                      </div>
                      <div className="composer-status-actions">
                        {voiceState !== "off" && (
                          <div
                            className={`voice-transient ${voiceState}`}
                            role="status"
                            aria-live="polite"
                          >
                            <span className="voice-pulse" />
                            <span>
                              {voicePartial || voiceState.replace("_", " ")}
                            </span>
                          </div>
                        )}
                        <button className="send" aria-label="Send message">
                          ↑
                        </button>
                      </div>
                    </div>
                    <p className="capability-copy">
                      {chatCli === "openrouter"
                        ? queuedHasImage
                          ? `Image pixels use ${openRouter?.settings.attachmentModel || "the Images model selected in Settings"}; documents are extracted locally · hosted cost · cancel available.`
                          : "Images are supported through the explicit Images model; PDF, Word, TXT, and Markdown are extracted locally · hosted cost · cancel available."
                        : chatCli === "codex"
                          ? "Images use Codex image input; PDF, Word, TXT, and Markdown are extracted locally with provenance."
                          : chatCli === "claude"
                            ? "Images use Claude structured image input; PDF, Word, TXT, and Markdown are extracted locally with provenance."
                            : "Grok ACP receives text. PDF, Word, TXT, and Markdown use integrity-checked run-scoped local paths that Grok can read with native tools. Images stay local because this Grok ACP version does not advertise image input."}{" "}
                      {chatCli !== "openrouter" &&
                        cliModels.find((item) => item.provider === chatCli)
                          ?.reason}
                      {` · ${selectedSecurityProfile?.name ?? "No authority profile"} · ${workspace.executionRoot ?? "no repository selected"}${selectedProviderSession?.status === "active" ? " · session resumed" : ""} · model-selected configuration tools ready`}
                      {platform === "win32" &&
                        selectedSecurityProfile?.tools.includes("terminal") &&
                        ` · Windows shell has host authority${selectedSecurityProfile.approval === "never" ? " · no approval prompts" : " · commands require approval"}`}
                    </p>
                  </form>
                  <small className="composer-hint">
                    Enter to send · Shift Enter for a new line · /browser for
                    controlled browsing
                  </small>
                </div>
              </>
            ) : (
              <section className="transcript">
                <div className="empty-chat">
                  <div className="compass">✦</div>
                  <h1>Start with a conversation.</h1>
                  <p>
                    Your chats become the path into notes, memories, and
                    everything Waypoint knows.
                  </p>
                  <button onClick={() => void beginNewChat()}>New chat</button>
                </div>
              </section>
            )}
          </div>
        ) : (
          <section className="tab-empty-state">
            <div className="compass">✦</div>
            <h1>No tabs open</h1>
            <p>Open a conversation or workspace tool from the sidebar.</p>
            <button onClick={() => void beginNewChat()}>New chat</button>
          </section>
        )}
      </main>

      {drawer && (
        <aside
          className={`right-drawer main-tab-view ${drawer === "browser" ? "browser-drawer" : ""} ${drawer === "settings" ? "settings-view" : ""}`}
          role="region"
          aria-labelledby="drawer-title"
        >
          <header>
            <div>
              <p>{workspace.name}</p>
              <h2 id="drawer-title">{workspaceViewTitles[drawer]}</h2>
            </div>
            <span className="view-persistence-note">Workspace view</span>
          </header>
          {drawer === "office" && (
            <Suspense
              fallback={
                <p className="drawer-empty" role="status">
                  Opening the command center…
                </p>
              }
            >
              <OfficeCommandCenter
                key={workspace.id}
                workspaceName={workspace.name}
                repositoryBoundary={workspace.executionRoot ?? ""}
                providerOptions={officeProviderOptions}
                chats={chats}
                runs={runs}
                requests={providerRequests}
                sessions={providerSessions}
                profiles={profiles}
                onOpenChat={openChatTab}
                onCancelRun={cancelRun}
                onAuthorizeProfile={authorizeSecurityProfile}
                onDispatchWorkOrder={dispatchOfficeWorkOrder}
              />
            </Suspense>
          )}
          {drawer === "browser" && (
            <div
              className={`in-app-browser ${inAppBrowserState?.loading ? "is-loading" : ""} ${inAppBrowserState?.error || error ? "has-error" : ""}`}
            >
              <div className="browser-chrome">
                <form
                  className="browser-toolbar"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void openInAppBrowser().catch(showError);
                  }}
                >
                  <div className="browser-nav-actions">
                    <button
                      type="button"
                      className="browser-icon-button"
                      aria-label="Back"
                      title="Back"
                      disabled={!inAppBrowserState?.canGoBack}
                      onClick={() =>
                        workspace &&
                        void window.waypoint.navigateInAppBrowser(
                          workspace.id,
                          "back",
                        )
                      }
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="browser-icon-button"
                      aria-label="Forward"
                      title="Forward"
                      disabled={!inAppBrowserState?.canGoForward}
                      onClick={() =>
                        workspace &&
                        void window.waypoint.navigateInAppBrowser(
                          workspace.id,
                          "forward",
                        )
                      }
                    >
                      →
                    </button>
                    <button
                      type="button"
                      className="browser-icon-button"
                      aria-label={
                        inAppBrowserState?.loading ? "Stop loading" : "Reload"
                      }
                      title={
                        inAppBrowserState?.loading ? "Stop loading" : "Reload"
                      }
                      onClick={() =>
                        workspace &&
                        void window.waypoint.navigateInAppBrowser(
                          workspace.id,
                          inAppBrowserState?.loading ? "stop" : "reload",
                        )
                      }
                    >
                      {inAppBrowserState?.loading ? "×" : "↻"}
                    </button>
                  </div>
                  <label className="browser-address-field">
                    <span className="browser-address-shield" aria-hidden="true">
                      ◈
                    </span>
                    <span className="sr-only">In-App Browser address</span>
                    <input
                      aria-label="In-App Browser address"
                      value={browserAddress}
                      onChange={(event) =>
                        setBrowserAddress(event.target.value)
                      }
                      placeholder="https://allowed.example"
                      spellCheck={false}
                      autoCapitalize="none"
                    />
                    <span className="browser-address-host" aria-hidden="true">
                      {browserHostLabel(browserAddress)}
                    </span>
                  </label>
                  <button className="browser-go-button">Go</button>
                  <div className="browser-session-actions">
                    <button
                      type="button"
                      aria-label="Close browser session"
                      title="Close browser session"
                      onClick={() =>
                        workspace &&
                        void window.waypoint.closeInAppBrowser(workspace.id)
                      }
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="browser-clear-button"
                      aria-label="Clear isolated browser data"
                      title="Clear isolated browser data"
                      onClick={() =>
                        workspace &&
                        void window.waypoint.clearInAppBrowser(workspace.id)
                      }
                    >
                      Clear data
                    </button>
                  </div>
                </form>
                {inAppBrowserState?.loading && (
                  <div className="browser-progress" aria-hidden="true">
                    <span />
                  </div>
                )}
                <div className="browser-identity" role="status">
                  <div className="browser-page-meta">
                    <i
                      className={
                        inAppBrowserState?.error || error
                          ? "error"
                          : inAppBrowserState?.loading
                            ? "loading"
                            : inAppBrowserState?.open
                              ? "ready"
                              : "closed"
                      }
                    />
                    <div>
                      <strong>
                        {inAppBrowserState?.title || "Private browser"}
                      </strong>
                      <small>
                        {inAppBrowserState?.loading
                          ? "Loading secure page…"
                          : inAppBrowserState?.error || error
                            ? "Page unavailable"
                            : inAppBrowserState?.open
                              ? browserHostLabel(
                                  inAppBrowserState.url || browserAddress,
                                )
                              : "Session closed"}
                      </small>
                    </div>
                  </div>
                  <div
                    className="browser-policy-chips"
                    aria-label="Browser policy"
                  >
                    <span title="Browser data is isolated to this Waypoint session">
                      ◉ {inAppBrowserState?.profile ?? "Waypoint isolated"}
                    </span>
                    <span title="Only explicitly allowed public domains can load">
                      ◇ Public domains only
                    </span>
                    <span title="Untrusted page JavaScript is disabled">
                      ⊘ Page scripts blocked
                    </span>
                  </div>
                </div>
                {(inAppBrowserState?.error || error) && (
                  <div className="browser-error-banner" role="alert">
                    <span>!</span>
                    <div>
                      <strong>Couldn’t open this page</strong>
                      <small>{inAppBrowserState?.error || error}</small>
                    </div>
                  </div>
                )}
              </div>
              <div
                ref={inAppBrowserSlotRef}
                className="in-app-browser-slot"
                aria-label="Waypoint In-App Browser content"
              >
                {!inAppBrowserState?.open && (
                  <div className="browser-empty-state">
                    <span aria-hidden="true">◎</span>
                    <strong>Browse without leaving Waypoint</strong>
                    <p>
                      Enter an approved HTTPS address above. Browsing stays in
                      an isolated profile with public-domain controls.
                    </p>
                    <small>Page scripts remain blocked by design.</small>
                  </div>
                )}
              </div>
            </div>
          )}
          {drawer === "reflection" && (
            <div className="drawer-body">
              <p className="drawer-intro">
                Review selected local sources with an already signed-in CLI.
                Sources are never overwritten and runs never schedule
                themselves.
              </p>
              <section>
                <h3>
                  Sources <span>{reflectionSources.length}/50</span>
                </h3>
                {[
                  ...memories.map((item) => ({
                    id: item.id,
                    title: item.title,
                    kind: "memory",
                  })),
                  ...documents.map((item) => ({
                    id: item.id,
                    title: item.title,
                    kind: "document",
                  })),
                ].map((item) => (
                  <label className="meeting-consent" key={item.id}>
                    <input
                      type="checkbox"
                      checked={reflectionSources.includes(item.id)}
                      onChange={(event) =>
                        setReflectionSources((current) =>
                          event.target.checked
                            ? [...current, item.id].slice(0, 50)
                            : current.filter((id) => id !== item.id),
                        )
                      }
                    />
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.kind} · {item.id}
                      </small>
                    </span>
                  </label>
                ))}
                <label className="settings-field">
                  <span>Local reflection provider</span>
                  <select
                    aria-label="Local reflection provider"
                    value={reflectionProvider}
                    onChange={(event) =>
                      setReflectionProvider(
                        event.target.value as "codex" | "claude" | "grok",
                      )
                    }
                  >
                    <option value="codex">Signed-in Codex CLI</option>
                    <option value="claude">Signed-in Claude Code CLI</option>
                    <option value="grok">Signed-in Grok Build CLI</option>
                  </select>
                </label>
                <div className="drawer-actions">
                  <button
                    disabled={!reflectionSources.length || reflectionActive}
                    onClick={() => void startReflection().catch(showError)}
                  >
                    {reflectionActive
                      ? "Reviewing…"
                      : "Reflect on selected sources"}
                  </button>
                  {reflectionActive && (
                    <button
                      className="secondary"
                      aria-label="Cancel active reflection"
                      onClick={() =>
                        workspace &&
                        void window.waypoint.cancelReflection(workspace.id)
                      }
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </section>
              <section aria-live="polite">
                <h3>Run history</h3>
                {reflectionRuns.map((run) => (
                  <button
                    className="secondary"
                    key={run.id}
                    aria-pressed={selectedReflectionRunId === run.id}
                    onClick={() =>
                      void selectReflectionRun(run.id).catch(showError)
                    }
                  >
                    {run.status} · {run.provider} ·{" "}
                    {new Date(run.createdAt).toLocaleString()}
                  </button>
                ))}
                {(() => {
                  const run = reflectionRuns.find(
                    (item) => item.id === selectedReflectionRunId,
                  );
                  return run ? (
                    <article className="knowledge-item">
                      <strong>{run.status}</strong>
                      <p>
                        Workspace: {workspace?.name} · {workspace?.id}
                      </p>
                      <p>
                        Provider: {run.provider} CLI · {run.providerVersion}
                      </p>
                      <p>Policy: {run.policyVersion}</p>
                      <p>Budget: {run.budgetJson}</p>
                      <p>Omissions: {run.omissionsJson}</p>
                      <small>
                        Run {run.id} · {run.createdAt}
                      </small>
                    </article>
                  ) : (
                    <p className="drawer-empty">No reflection run yet.</p>
                  );
                })()}
              </section>
              <section>
                <h3>
                  Proposed revisions <span>{reflectionProposals.length}</span>
                </h3>
                {reflectionProposals.map((item) => (
                  <article
                    className="knowledge-item suggestion-item"
                    key={item.id}
                  >
                    <div>
                      <small className="suggestion-meta">
                        {item.kind} · {item.status} ·{" "}
                        {item.sourceIds.split(",").length} sources
                      </small>
                      <strong>{item.title}</strong>
                      <p>{item.rationale}</p>
                      <small>Before</small>
                      <p>{item.beforeBody}</p>
                      <small>Proposed</small>
                      <p>
                        {item.proposedBody ||
                          "No winner selected. Edit is required before acceptance."}
                      </p>
                      <small>
                        Sources: {item.sourceIds} · digests {item.sourceDigests}
                      </small>
                    </div>
                    <div className="knowledge-actions">
                      {item.status === "proposed" && (
                        <>
                          <button
                            disabled={!item.proposedBody}
                            onClick={() =>
                              void resolveReflection(item, "accept").catch(
                                showError,
                              )
                            }
                          >
                            Accept
                          </button>
                          <button
                            onClick={() =>
                              void resolveReflection(item, "edit").catch(
                                showError,
                              )
                            }
                          >
                            Edit &amp; accept
                          </button>
                          <button
                            onClick={() =>
                              void resolveReflection(item, "reject").catch(
                                showError,
                              )
                            }
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {["accepted", "edited"].includes(item.status) && (
                        <button
                          onClick={() =>
                            void resolveReflection(item, "rollback").catch(
                              showError,
                            )
                          }
                        >
                          Rollback
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!reflectionProposals.length && (
                  <p className="drawer-empty">No proposals for this run.</p>
                )}
              </section>
            </div>
          )}
          {drawer === "knowledge" && (
            <div className="drawer-body">
              <p className="drawer-intro">
                Review what Waypoint may remember from conversation. Nothing
                becomes durable knowledge until you approve it.
              </p>
              <div className="drawer-actions">
                <button onClick={() => void scanSuggestions()}>
                  Review conversation
                </button>
              </div>
              <section>
                <h3>
                  Suggestions <span>{suggestions.length}</span>
                </h3>
                {suggestions.map((item) => (
                  <article
                    className="knowledge-item suggestion-item"
                    key={item.id}
                  >
                    <div>
                      <small className="suggestion-meta">
                        {item.category} · {Math.round(item.confidence * 100)}% ·{" "}
                        {item.sourceRole}
                      </small>
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                      <small>Source: “{item.sourceExcerpt}”</small>
                    </div>
                    <div className="knowledge-actions">
                      <button
                        onClick={() => void resolveSuggestion(item, "accept")}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() =>
                          void resolveSuggestion(item, "accept", true)
                        }
                      >
                        Edit &amp; accept
                      </button>
                      <button
                        onClick={() => void resolveSuggestion(item, "reject")}
                      >
                        Reject
                      </button>
                    </div>
                  </article>
                ))}
                {!suggestions.length && (
                  <p className="drawer-empty">
                    No pending suggestions. Review the current conversation when
                    you are ready.
                  </p>
                )}
              </section>
              <section>
                <h3>
                  Commitments{" "}
                  <span>
                    {
                      commitments.filter((item) => item.status === "open")
                        .length
                    }
                  </span>
                </h3>
                {commitments.map((item) => (
                  <article
                    id={`activity-target-${item.id}`}
                    className={`knowledge-item commitment-item ${item.status} ${activityKnowledgeTarget === item.id ? "activity-target" : ""}`}
                    key={item.id}
                  >
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                      <small>Source: “{item.sourceExcerpt}”</small>
                    </div>
                    <button
                      aria-label={`${item.status === "open" ? "Complete" : "Reopen"} ${item.title}`}
                      onClick={() => void toggleCommitment(item)}
                    >
                      {item.status === "open" ? "Complete" : "Reopen"}
                    </button>
                  </article>
                ))}
                {!commitments.length && (
                  <p className="drawer-empty">No accepted commitments.</p>
                )}
              </section>
              <section>
                <h3>
                  Notes <span>{documents.length}</span>
                </h3>
                <div className="knowledge-actions">
                  <button
                    disabled={documentImportBusy}
                    onClick={() => void importDocument()}
                  >
                    Import PDF, Word, or text
                  </button>
                </div>
                {documents.map((item) => (
                  <article
                    id={`activity-target-${item.id}`}
                    className={`knowledge-item ${activityKnowledgeTarget === item.id ? "activity-target" : ""}`}
                    key={item.id}
                  >
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.body.slice(0, 180)}</p>
                      {documentIndexes[item.id]?.sourceAvailable && (
                        <small>
                          {documentIndexes[item.id].sourceName} ·{" "}
                          {documentIndexes[item.id].state === "indexed"
                            ? `${documentIndexes[item.id].chunkCount} semantic chunks · ${documentIndexes[item.id].model}`
                            : "lexical search ready · local embedding unavailable or not built"}
                        </small>
                      )}
                    </div>
                    <div className="knowledge-actions">
                      <button
                        aria-label={`Edit ${item.title}`}
                        onClick={() => void editDocument(item)}
                      >
                        Edit
                      </button>
                      {documentIndexes[item.id]?.sourceAvailable && (
                        <button
                          disabled={documentImportBusy}
                          aria-label={`Reindex ${item.title}`}
                          onClick={() => void reindexDocument(item.id)}
                        >
                          Reindex
                        </button>
                      )}
                      {(documentIndexes[item.id]?.retainedGenerations ?? 0) >
                        1 && (
                        <button
                          disabled={documentImportBusy}
                          aria-label={`Roll back index for ${item.title}`}
                          onClick={() => void rollbackDocumentIndex(item.id)}
                        >
                          Roll back index
                        </button>
                      )}
                      <button
                        aria-label={`Delete ${item.title}`}
                        onClick={() => void remove("document", item.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
                {!documents.length && (
                  <p className="drawer-empty">
                    No notes yet. Use Save to knowledge on an assistant
                    response.
                  </p>
                )}
              </section>
              <section>
                <h3>
                  Memories <span>{memories.length}</span>
                </h3>
                {memories.map((item) => (
                  <article
                    id={`activity-target-${item.id}`}
                    className={`knowledge-item ${activityKnowledgeTarget === item.id ? "activity-target" : ""}`}
                    key={item.id}
                  >
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.body.slice(0, 180)}</p>
                    </div>
                    <button
                      aria-label={`Delete ${item.title}`}
                      onClick={() => void remove("memory", item.id)}
                    >
                      Delete
                    </button>
                  </article>
                ))}
                {!memories.length && (
                  <p className="drawer-empty">No memories yet.</p>
                )}
              </section>
            </div>
          )}
          {drawer === "rules" && (
            <div className="drawer-body">
              <p className="drawer-intro">
                Review workspace relationships and repeated directives. Rules
                remain advisory and cannot change tools, providers, security,
                schedules, sync, or external systems.
              </p>
              <div className="drawer-actions">
                <button onClick={() => void scanRules()}>
                  Scan repeated directives
                </button>
              </div>
              <section>
                <h3>
                  Rule suggestions <span>{ruleSuggestions.length}</span>
                </h3>
                {ruleSuggestions.map((item) => (
                  <article
                    className="knowledge-item suggestion-item"
                    key={item.id}
                  >
                    <div>
                      <small className="suggestion-meta">
                        {item.scope} · v{item.extractorVersion} ·{" "}
                        {item.sources.length} sources
                      </small>
                      <strong>{item.statement}</strong>
                      {item.sources.map((source) => (
                        <small key={source.messageId}>
                          “{source.excerpt}” · {source.messageId.slice(0, 10)}…
                        </small>
                      ))}
                    </div>
                    <div className="knowledge-actions">
                      <button onClick={() => void dryRunRule(item)}>
                        Dry run
                      </button>
                      <button
                        disabled={!item.lastDryRunAt}
                        onClick={() => void resolveRule(item, "approve")}
                      >
                        Approve
                      </button>
                      <button onClick={() => void resolveRule(item, "reject")}>
                        Reject
                      </button>
                    </div>
                  </article>
                ))}
                {!ruleSuggestions.length && (
                  <p className="drawer-empty">
                    No repeated user directives are waiting for review.
                  </p>
                )}
              </section>
              <section>
                <h3>
                  Advisory rules <span>{learnedRules.length}</span>
                </h3>
                {learnedRules.map((item) => (
                  <article
                    className={`knowledge-item rule-item ${item.enabled ? "enabled" : "disabled"}`}
                    key={item.id}
                  >
                    <div>
                      <small className="suggestion-meta">
                        workspace · v{item.version} ·{" "}
                        {item.enabled ? "enabled" : "disabled"}
                      </small>
                      <strong>{item.statement}</strong>
                      <small>
                        {item.outcomes
                          .map(
                            (outcome) =>
                              `${outcome.action} (${outcome.matchCount})`,
                          )
                          .join(" · ")}
                      </small>
                    </div>
                    <div className="knowledge-actions">
                      <button onClick={() => void toggleRule(item)}>
                        {item.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        disabled={item.priorEnabled === null}
                        onClick={() => void revertRule(item)}
                      >
                        Revert
                      </button>
                    </div>
                  </article>
                ))}
                {!learnedRules.length && (
                  <p className="drawer-empty">No approved advisory rules.</p>
                )}
              </section>
              <section>
                <h3>
                  Knowledge graph <span>{knowledgeGraph.nodes.length}</span>
                </h3>
                {knowledgeGraph.nodes.map((node) => (
                  <button
                    className="graph-node"
                    key={node.id}
                    onClick={() => {
                      if (node.kind === "chat") openChatTab(node.id);
                      else openViewTab("knowledge");
                    }}
                  >
                    <span>{node.kind}</span>
                    <strong>{node.title}</strong>
                    <small>
                      {knowledgeGraph.edges
                        .filter(
                          (edge) =>
                            edge.fromId === node.id || edge.toId === node.id,
                        )
                        .map(
                          (edge) =>
                            `${edge.fromId === node.id ? "→" : "←"} ${edge.type}`,
                        )
                        .join(" · ") || "No visible relationships"}
                    </small>
                  </button>
                ))}
                {!knowledgeGraph.nodes.length && (
                  <p className="drawer-empty">
                    Relationships appear after knowledge is saved from
                    conversation.
                  </p>
                )}
              </section>
            </div>
          )}
          {drawer === "briefing" && briefing && (
            <div className="drawer-body">
              <p className="drawer-intro">
                A bounded local review for {briefing.localDay} in{" "}
                {briefing.timezone}. Generated{" "}
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: briefing.timezone,
                }).format(new Date(briefing.generatedAt))}
                . External accounts were not checked.
              </p>
              <div className="drawer-actions">
                <button onClick={() => void openBriefing()}>
                  Refresh briefing
                </button>
              </div>
              <section>
                <h3>
                  For review <span>{briefing.items.length}</span>
                </h3>
                {briefing.items.map((item) => (
                  <article
                    className="knowledge-item briefing-item"
                    key={`${item.kind}:${item.id}`}
                  >
                    <div>
                      <small className="suggestion-meta">
                        {item.kind} · {item.freshness} · {item.id.slice(0, 12)}…
                      </small>
                      <strong>{item.title}</strong>
                      <p>
                        {item.missingSource ? (
                          "Source content is unavailable."
                        ) : (
                          <>
                            {item.detail.slice(0, 240)}
                            {item.detail.length > 240 || item.detailTruncated
                              ? "…"
                              : ""}
                          </>
                        )}
                      </p>
                      <small>
                        {item.whyIncluded} · source excerpt · updated{" "}
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: briefing.timezone,
                        }).format(new Date(item.updatedAt))}
                      </small>
                    </div>
                    <button
                      aria-label={`Dismiss ${item.title} for ${briefing.localDay}`}
                      onClick={() => void dismissBriefing(item)}
                    >
                      Dismiss today
                    </button>
                  </article>
                ))}
                {!briefing.items.length && (
                  <p className="drawer-empty">
                    Nothing local is waiting for review today.
                  </p>
                )}
              </section>
              <section>
                <h3>Coverage</h3>
                <p className="drawer-intro">
                  {briefing.coverage.openCommitments} open commitments ·{" "}
                  {briefing.coverage.documents} notes ·{" "}
                  {briefing.coverage.memories} memories ·{" "}
                  {briefing.coverage.dismissed} dismissed today ·{" "}
                  {briefing.coverage.missingSources} missing sources ·{" "}
                  {briefing.coverage.omittedByLimit} omitted by limit
                </p>
                {briefing.omissions.map((item) => (
                  <p className="briefing-omission" key={item}>
                    {item}
                  </p>
                ))}
              </section>
            </div>
          )}
          {drawer === "meetings" && (
            <div className="drawer-body">
              <p className="drawer-intro">
                Audio-only recording stays on this device and is never synced or
                uploaded. Confirm that everyone has consented and that recording
                is legal where you are. Recordings remain until you explicitly
                delete them.
              </p>
              <label className="meeting-consent">
                <input
                  type="checkbox"
                  checked={meetingConsent}
                  disabled={Boolean(recordingMeetingId)}
                  onChange={(event) => setMeetingConsent(event.target.checked)}
                />{" "}
                I have informed participants and confirmed consent for this
                recording session.
              </label>
              {recordingMeetingId ? (
                <div
                  className="recording-state"
                  role="status"
                  aria-live="assertive"
                >
                  <i /> Recording · {Math.floor(recordingSeconds / 60)}:
                  {String(recordingSeconds % 60).padStart(2, "0")}
                  <button onClick={() => void stopMeeting().catch(showError)}>
                    Stop &amp; save locally
                  </button>
                </div>
              ) : (
                <div className="drawer-actions">
                  <button
                    disabled={!meetingConsent}
                    onClick={() => void startMeeting().catch(showError)}
                  >
                    Start audio recording
                  </button>
                </div>
              )}
              <p className="transcription-note">
                {transcriptionCapability?.reason}
              </p>
              <section>
                <h3>
                  Local recordings <span>{meetings.length}</span>
                </h3>
                {meetings.map((item) => (
                  <article className="meeting-item" key={item.id}>
                    <header>
                      <div>
                        <strong>{item.title}</strong>
                        <small>
                          {item.status} ·{" "}
                          {item.bytes
                            ? `${(item.bytes / 1024 / 1024).toFixed(1)} MiB`
                            : "no saved audio"}{" "}
                          · speakers uncertain
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          void removeMeeting(item.id).catch(showError)
                        }
                      >
                        Delete
                      </button>
                    </header>
                    {item.status === "ready" && (
                      <>
                        <div className="meeting-actions">
                          <button
                            onClick={() =>
                              void playMeeting(item.id).catch(showError)
                            }
                          >
                            {meetingPlayback?.meetingId === item.id
                              ? "Hide player"
                              : "Play"}
                          </button>
                          <button
                            onClick={() =>
                              void window.waypoint
                                .exportMeetingAudio(workspace.id, item.id)
                                .catch(showError)
                            }
                          >
                            Export audio
                          </button>
                          {meetingTranscriptionRun?.meetingId === item.id ? (
                            <button
                              onClick={() =>
                                void cancelMeetingTranscription().catch(
                                  showError,
                                )
                              }
                            >
                              {meetingTranscriptionRun.phase === "preparing"
                                ? "Cancel · preparing audio"
                                : `Cancel transcription (${meetingTranscriptionRun.completed}/${meetingTranscriptionRun.total ?? "?"} segments)`}
                            </button>
                          ) : (
                            <button
                              disabled={
                                !transcriptionCapability?.available ||
                                Boolean(meetingTranscriptionRun)
                              }
                              onClick={() => void transcribeMeeting(item.id)}
                            >
                              Transcribe locally
                            </button>
                          )}
                        </div>
                        {meetingPlayback?.meetingId === item.id && (
                          <audio
                            className="meeting-player"
                            controls
                            autoPlay
                            preload="metadata"
                            src={meetingPlayback.url}
                            onError={() =>
                              showError(
                                "The local recording player could not load this audio.",
                              )
                            }
                          >
                            Local audio playback is unavailable in this
                            renderer.
                          </audio>
                        )}
                        <textarea
                          aria-label={`Transcript draft for ${item.title}`}
                          placeholder="Enter or paste a local transcript draft. Mark uncertain speakers like “Speaker 1?”."
                          value={transcriptDrafts[item.id] ?? ""}
                          onChange={(event) =>
                            setTranscriptDrafts((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                        <div className="meeting-actions">
                          <button
                            onClick={() =>
                              void saveTranscript(item.id, false).catch(
                                showError,
                              )
                            }
                          >
                            Save draft
                          </button>
                          <button
                            onClick={() =>
                              void saveTranscript(item.id, true).catch(
                                showError,
                              )
                            }
                          >
                            Mark reviewed
                          </button>
                          <button
                            disabled={item.transcriptStatus !== "reviewed"}
                            onClick={() =>
                              void saveMeetingMemory(item.id).catch(showError)
                            }
                          >
                            Save to knowledge
                          </button>
                        </div>
                      </>
                    )}
                    {item.status === "failed" && (
                      <p>
                        Capture ended without a retained audio artifact (
                        {item.failureCode?.replaceAll("_", " ")}). Delete this
                        record when no longer useful.
                      </p>
                    )}
                  </article>
                ))}
                {!meetings.length && (
                  <p className="drawer-empty">No local meeting recordings.</p>
                )}
              </section>
            </div>
          )}
          {drawer === "activity" && (
            <div className="drawer-body">
              <section
                className="capture-console"
                aria-label="Whole-device activity capture"
              >
                <header>
                  <div>
                    <strong>Whole-device history</strong>
                    <small role="status">
                      {!activityCapture
                        ? "Checking…"
                        : !activityCapture.policy.enabled
                          ? "Off"
                          : activityCapture.policy.paused ||
                              !activityCapture.readiness.available
                            ? "Paused"
                            : "Capturing periodic snapshots"}
                    </small>
                  </div>
                  <span
                    className={
                      activityCapture?.policy.enabled &&
                      !activityCapture.policy.paused &&
                      activityCapture.readiness.available
                        ? "active"
                        : "paused"
                    }
                  />
                </header>
                <p>
                  Opt-in periodic screenshots, never video. Pause is immediate
                  and never backfills. No cloud capture or raw OCR is placed in
                  receipts.
                </p>
                {activityCapture && (
                  <>
                    <div className="capture-readiness">
                      <strong>
                        {activityCapture.readiness.available
                          ? "Native capture ready"
                          : "Native capture unavailable"}
                      </strong>
                      <span>{activityCapture.readiness.reason}</span>
                    </div>
                    <label>
                      Raw snapshot retention
                      <select
                        aria-label="Raw snapshot retention"
                        value={activityCapture.policy.retentionDays}
                        onChange={(event) =>
                          void updateActivityCapture({
                            retentionDays: Number(event.target.value) as
                              90 | 183 | 365,
                          }).catch(showError)
                        }
                      >
                        <option value="90">90 days</option>
                        <option value="183">6 months</option>
                        <option value="365">1 year</option>
                      </select>
                    </label>
                    <label>
                      Excluded app bundle IDs or process names
                      <textarea
                        aria-label="Excluded apps, one per line"
                        value={activityExclusions}
                        onChange={(event) =>
                          setActivityExclusions(event.target.value)
                        }
                        onBlur={() =>
                          void updateActivityCapture({
                            exclusions: activityExclusions
                              .split("\n")
                              .map((item) => item.trim())
                              .filter(Boolean),
                          }).catch(showError)
                        }
                        placeholder="com.example.private-app"
                      />
                    </label>
                    <label className="capture-check">
                      <input
                        type="checkbox"
                        checked={activityCapture.policy.syncRaw}
                        onChange={(event) =>
                          void updateActivityCapture({
                            syncRaw: event.target.checked,
                          }).catch(showError)
                        }
                      />
                      Encrypted raw snapshot sync and backup (can use
                      substantial storage/bandwidth)
                    </label>
                    <div className="drawer-actions">
                      <button
                        disabled={!activityCapture.readiness.available}
                        onClick={() =>
                          void updateActivityCapture({
                            enabled: true,
                            paused: false,
                          }).catch(showError)
                        }
                      >
                        Preview &amp; resume
                      </button>
                      <button
                        className="secondary"
                        disabled={
                          !activityCapture.policy.enabled ||
                          activityCapture.policy.paused
                        }
                        onClick={() =>
                          void updateActivityCapture({ paused: true }).catch(
                            showError,
                          )
                        }
                      >
                        Pause now
                      </button>
                      <button
                        className="secondary"
                        disabled={!activityCapture.policy.enabled}
                        onClick={() =>
                          void updateActivityCapture({
                            enabled: false,
                            paused: true,
                          }).catch(showError)
                        }
                      >
                        Stop
                      </button>
                    </div>
                    <small>
                      {activityCapture.storage.count} snapshots ·{" "}
                      {(activityCapture.storage.bytes / 1024 / 1024).toFixed(1)}{" "}
                      MB local raw storage
                    </small>
                  </>
                )}
                <div className="activity-filters">
                  <input
                    aria-label="Search captured app timeline"
                    placeholder="Search app, process, or device"
                    value={activitySnapshotQuery}
                    onChange={(event) =>
                      setActivitySnapshotQuery(event.target.value)
                    }
                  />
                  <button
                    disabled={!activitySnapshots.length}
                    onClick={() =>
                      void removeAllActivitySnapshots().catch(showError)
                    }
                  >
                    Delete all raw
                  </button>
                </div>
                {activitySnapshots.map((item) => (
                  <article className="capture-item" key={item.id}>
                    <div>
                      <strong>{item.appTitle || item.appProcess}</strong>
                      <small>
                        {item.appBundleId} · {item.deviceId} / {item.displayId}
                      </small>
                      <small>
                        Captured{" "}
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(item.capturedAt))}{" "}
                        · expires{" "}
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                        }).format(new Date(item.expiresAt))}{" "}
                        · {(item.bytes / 1024).toFixed(1)} KB
                        {item.synced
                          ? " · encrypted sync queued/retained"
                          : " · local only"}
                      </small>
                    </div>
                    <div>
                      <button
                        aria-label={`View snapshot from ${item.appTitle || item.appProcess}`}
                        onClick={() =>
                          void previewActivitySnapshot(item.id).catch(showError)
                        }
                      >
                        View
                      </button>
                      <button
                        aria-label={`Delete snapshot from ${item.appTitle || item.appProcess}`}
                        onClick={() =>
                          void removeActivitySnapshot(item.id).catch(showError)
                        }
                      >
                        Delete
                      </button>
                    </div>
                    {activityPreview?.id === item.id && (
                      <figure className="capture-preview">
                        <img
                          src={activityPreview.url}
                          alt={`Private snapshot from ${item.appTitle || item.appProcess} at ${item.capturedAt}`}
                        />
                        <button onClick={() => setActivityPreview(undefined)}>
                          Close preview
                        </button>
                      </figure>
                    )}
                  </article>
                ))}
                {!activitySnapshots.length && (
                  <p className="drawer-empty">
                    No raw activity snapshots. Waypoint has not captured this
                    screen.
                  </p>
                )}
              </section>
              <p className="drawer-intro">
                A workspace-scoped history of meaningful local actions. Event
                details never copy prompts, documents, transcripts, file paths,
                or credentials.
              </p>
              <div className="activity-filters">
                <input
                  value={activityQuery}
                  onChange={(event) => setActivityQuery(event.target.value)}
                  placeholder="Filter activity"
                  aria-label="Filter activity"
                />
                <select
                  value={activityFamilyFilter}
                  onChange={(event) =>
                    setActivityFamilyFilter(
                      event.target.value as ActivityFamily | "all",
                    )
                  }
                  aria-label="Activity family"
                >
                  <option value="all">All activity</option>
                  <option value="content">Content</option>
                  <option value="execution">AI execution</option>
                  <option value="sync">Sync &amp; devices</option>
                  <option value="rules">Rules</option>
                  <option value="automation">Automations</option>
                  <option value="meeting">Meetings</option>
                  <option value="lifecycle">Deletion</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </div>
              {activity
                .filter(
                  (item) =>
                    (activityFamilyFilter === "all" ||
                      item.family === activityFamilyFilter) &&
                    (!activityQuery.trim() ||
                      [
                        item.action,
                        item.family,
                        item.objectKind,
                        item.objectTitle ?? "",
                      ].some((value) =>
                        value
                          .toLocaleLowerCase()
                          .includes(activityQuery.trim().toLocaleLowerCase()),
                      )),
                )
                .map((item) => (
                  <article
                    className={`activity-item ${item.family} ${item.objectState}`}
                    key={item.id}
                  >
                    <span />
                    <div>
                      <small className="activity-family">
                        {item.family} · {item.objectState}
                      </small>
                      <strong>{item.action.replaceAll(".", " ")}</strong>
                      {Object.keys(item.details).length > 0 && (
                        <small>
                          {Object.entries(item.details)
                            .map(([key, value]) => `${key}: ${String(value)}`)
                            .join(" · ")}
                        </small>
                      )}
                      {item.objectTitle && (
                        <button
                          onClick={() => followActivity(item)}
                          disabled={
                            item.objectState !== "available" || !item.targetId
                          }
                        >
                          {item.objectTitle}
                        </button>
                      )}
                      <small>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(item.createdAt))}
                      </small>
                    </div>
                  </article>
                ))}
              {!activity.filter(
                (item) =>
                  (activityFamilyFilter === "all" ||
                    item.family === activityFamilyFilter) &&
                  (!activityQuery.trim() ||
                    [
                      item.action,
                      item.family,
                      item.objectKind,
                      item.objectTitle ?? "",
                    ].some((value) =>
                      value
                        .toLocaleLowerCase()
                        .includes(activityQuery.trim().toLocaleLowerCase()),
                    )),
              ).length && (
                <p className="drawer-empty">
                  No activity matches this filter. Meeting and automation events
                  appear only after those features are explicitly enabled.
                </p>
              )}
            </div>
          )}
          {drawer === "health" && (
            <div className="drawer-body">
              <div className="drawer-actions">
                <button onClick={() => void runHealth()} disabled={checking}>
                  {checking ? "Checking…" : "Run local checks"}
                </button>
              </div>
              {diagnostics?.results.map((item) => (
                <article
                  className={`health-item ${item.status}`}
                  key={item.code}
                >
                  <span>{item.status.replace("_", " ")}</span>
                  <strong>{item.code}</strong>
                  <p>{item.summary}</p>
                  {item.remediation && <small>{item.remediation}</small>}
                </article>
              )) || (
                <p className="drawer-empty">
                  Check the database, storage, attachments, indexes, CLIs, and
                  local sync state.
                </p>
              )}
            </div>
          )}
          {drawer === "settings" && (
            <div className="drawer-body settings-page-body">
              <nav className="settings-page-nav" aria-label="Settings sections">
                <strong>Settings</strong>
                {[
                  ["settings-agent-workspace", "Agent workspace"],
                  ["settings-appearance", "Appearance"],
                  ["settings-capture", "Screen capture"],
                  ["settings-tools", "AI tools"],
                  ["settings-voice", "Voice chat"],
                  ["settings-models", "Models"],
                  ["settings-sync", "Device sync"],
                  ["settings-backup", "Backup"],
                  ["settings-providers", "Provider status"],
                  ["settings-budgets", "Execution budgets"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() =>
                      document.getElementById(id)?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <div className="settings-content">
                <div className="settings-page-intro">
                  <p>Waypoint preferences</p>
                  <h1>Settings</h1>
                  <span>
                    Configure local tools, models, capture, voice, sync, and
                    recovery without leaving your active work.
                  </span>
                </div>
                <section
                  id="settings-agent-workspace"
                  className="settings-section"
                >
                  <h3>Agent workspace</h3>
                  <p className="drawer-intro">
                    Choose the repository or folder that Codex, Claude, and
                    OpenRouter tools may inspect or change. Waypoint’s private
                    chats, notes, recordings, and indexes stay in separate app
                    storage.
                  </p>
                  <div
                    className={`automation-boundary ${workspace?.executionRoot ? "" : "warning"}`}
                    role="status"
                  >
                    <strong>
                      {workspace?.executionRoot
                        ? "Repository connected"
                        : "No repository selected"}
                    </strong>
                    <span>
                      {workspace?.executionRoot ??
                        "Provider chats use a private Waypoint working area. Choose a repository before asking an agent to work on code."}
                    </span>
                  </div>
                  <div className="drawer-actions">
                    <button
                      onClick={() =>
                        void chooseWorkspaceExecutionRoot().catch(showError)
                      }
                    >
                      {workspace?.executionRoot
                        ? "Change repository"
                        : "Choose repository"}
                    </button>
                    {workspace?.executionRoot && (
                      <button
                        className="secondary"
                        onClick={() =>
                          void clearWorkspaceExecutionRoot().catch(showError)
                        }
                      >
                        Clear repository
                      </button>
                    )}
                  </div>
                  <div
                    className="authority-profile-grid"
                    aria-label="Agent authority profiles"
                  >
                    {profiles.map((profile) => (
                      <article
                        className={`authority-profile-card${profile.approval === "never" ? " bypass" : ""}`}
                        key={profile.id}
                      >
                        <strong>{profile.name}</strong>
                        <small>
                          {profile.filesystem.replace("-", " ")} ·{" "}
                          {profile.network === "enabled"
                            ? "network enabled"
                            : "provider network only"}{" "}
                          ·{" "}
                          {profile.approval === "never"
                            ? "no prompts; explicit high-risk mode"
                            : profile.approval === "on-write"
                              ? "approve changes and commands"
                              : "read-only authority"}
                        </small>
                        <span>
                          {profile.tools.join(" · ") || "No provider tools"}
                        </span>
                        {platform === "win32" &&
                          profile.tools.includes("terminal") && (
                            <em>
                              Windows shell and PowerShell are host authority,
                              not repository/network sandboxing.{" "}
                              {profile.approval === "never"
                                ? "No prompts; "
                                : "Each command requires approval; "}
                              audit and Stop/Cancel remain active.
                            </em>
                          )}
                      </article>
                    ))}
                  </div>
                  <div className="automation-boundary" role="status">
                    <strong>Provider sessions</strong>
                    <span>
                      {
                        providerSessions.filter(
                          (item) => item.status === "active",
                        ).length
                      }{" "}
                      active ·{" "}
                      {
                        providerSessions.filter(
                          (item) => item.status === "stale",
                        ).length
                      }{" "}
                      invalidated ·{" "}
                      {
                        providerRequests.filter(
                          (item) => item.status === "pending",
                        ).length
                      }{" "}
                      waiting for a decision
                    </span>
                  </div>
                  {providerSessions
                    .filter((item) => item.status === "active")
                    .map((session) => (
                      <div className="provider-row" key={session.id}>
                        <strong>
                          {session.provider} · active chat session
                        </strong>
                        <small>
                          {session.model || "CLI-selected model"} ·{" "}
                          {session.executionRoot}
                        </small>
                        <button
                          className="secondary"
                          onClick={() =>
                            void window.waypoint
                              .resetProviderSession(
                                session.workspaceId,
                                session.chatId,
                                session.provider,
                              )
                              .then(() => refresh())
                              .catch(showError)
                          }
                        >
                          Reset session
                        </button>
                      </div>
                    ))}
                </section>
                <section id="settings-appearance" className="settings-section">
                  <h3>Appearance</h3>
                  <p className="drawer-intro">
                    Choose Waypoint’s visual atmosphere on this device. System
                    follows your operating-system appearance automatically.
                  </p>
                  <div
                    className="appearance-picker"
                    role="radiogroup"
                    aria-label="App appearance"
                  >
                    {(
                      [
                        ["system", "System", "Follow this device"],
                        ["light", "Light", "Clear paper and sage"],
                        ["dark", "Dark", "Midnight cartography"],
                      ] as const
                    ).map(([value, label, detail]) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={appearance === value}
                        id={`appearance-${value}`}
                        tabIndex={appearance === value ? 0 : -1}
                        onClick={() => changeAppearance(value)}
                        onKeyDown={(event) => {
                          const next = nextAppearanceFromKey(
                            appearance,
                            event.key,
                          );
                          if (!next) return;
                          event.preventDefault();
                          changeAppearance(next);
                          window.requestAnimationFrame(() =>
                            document
                              .getElementById(`appearance-${next}`)
                              ?.focus(),
                          );
                        }}
                        key={value}
                      >
                        <span
                          className={`appearance-swatch ${value}`}
                          aria-hidden="true"
                        />
                        <strong>{label}</strong>
                        <small>{detail}</small>
                      </button>
                    ))}
                  </div>
                  <small className="appearance-status" role="status">
                    {appearance === "system"
                      ? `Following your device · currently ${resolveAppearance(appearance, systemDark) === "dark" ? "Dark" : "Light"}`
                      : `${appearance === "dark" ? "Midnight cartography" : "Light"} is active on this device`}
                  </small>
                </section>
                <section id="settings-capture" className="settings-section">
                  <h3>Screen capture</h3>
                  <p className="drawer-intro">
                    Choose whether your shortcut opens the full capture studio
                    or takes a screenshot immediately. Captures stay local and
                    are never sent to a model unless you explicitly add one to
                    chat.
                  </p>
                  <div className="automation-boundary" role="status">
                    <strong>
                      {manualCaptureReadiness?.available
                        ? "Native capture ready"
                        : manualCaptureReadiness?.state ===
                            "permission_request_required"
                          ? "Installed build needs a fresh permission grant"
                          : manualCaptureReadiness?.state ===
                              "permission_restricted"
                            ? "Screen Recording is restricted"
                            : manualCaptureReadiness?.state ===
                                "permission_denied"
                              ? "Screen Recording is disabled"
                          : "Permission required"}
                    </strong>
                    <span>
                      {manualCaptureReadiness?.reason ||
                        "Checking platform capture readiness…"}{" "}
                      {manualCaptureReadiness?.shortcut.reason}
                    </span>
                  </div>
                  {capturePermissionError && (
                    <p className="field-error" role="alert">
                      {capturePermissionError}
                    </p>
                  )}
                  {platform === "darwin" &&
                    manualCaptureReadiness &&
                    !manualCaptureReadiness.available && (
                      <div className="drawer-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setCapturePermissionError("");
                            void window.waypoint
                              .openScreenRecordingSettings()
                              .catch((reason) => {
                                const message =
                                  reason instanceof Error
                                    ? reason.message
                                    : "Could not open Screen Recording Settings";
                                setCapturePermissionError(message);
                                showError(reason);
                              });
                          }}
                        >
                          Open Screen Recording Settings
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setCapturePermissionError("");
                            void window.waypoint
                              .screenCaptureReadiness()
                              .then(setManualCaptureReadiness)
                              .catch((reason) => {
                                const message =
                                  reason instanceof Error
                                    ? reason.message
                                    : "Could not check Screen Recording permission";
                                setCapturePermissionError(message);
                                showError(reason);
                              });
                          }}
                        >
                          Check permission again
                        </button>
                      </div>
                    )}
                  {manualCaptureSettings && (
                    <>
                      <div
                        className="capture-workflow-picker"
                        role="radiogroup"
                        aria-label="Shortcut behavior"
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={
                            manualCaptureSettings.workflow === "guided"
                          }
                          className={
                            manualCaptureSettings.workflow === "guided"
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            setManualCaptureSettings({
                              ...manualCaptureSettings,
                              workflow: "guided",
                            })
                          }
                        >
                          <span
                            className="capture-workflow-icon"
                            aria-hidden="true"
                          >
                            ▣
                          </span>
                          <strong>Guided capture</strong>
                          <small>
                            Open the source picker, preview, crop, annotation
                            tools, and capture library.
                          </small>
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={
                            manualCaptureSettings.workflow === "quick"
                          }
                          className={
                            manualCaptureSettings.workflow === "quick"
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            setManualCaptureSettings({
                              ...manualCaptureSettings,
                              workflow: "quick",
                            })
                          }
                        >
                          <span
                            className="capture-workflow-icon"
                            aria-hidden="true"
                          >
                            +
                          </span>
                          <strong>Quick capture</strong>
                          <small>
                            Stay out of the way. Capture and copy immediately
                            with no Waypoint window.
                          </small>
                        </button>
                      </div>
                      <div
                        className="settings-grid"
                        aria-label="Manual screen capture settings"
                      >
                        <label>
                          {manualCaptureSettings.workflow === "quick"
                            ? "Quick capture target"
                            : "Default capture target"}
                          <select
                            value={manualCaptureSettings.mode}
                            onChange={(event) =>
                              setManualCaptureSettings({
                                ...manualCaptureSettings,
                                mode: event.target
                                  .value as typeof manualCaptureSettings.mode,
                              })
                            }
                          >
                            <option value="region">
                              {manualCaptureSettings.workflow === "quick"
                                ? "Region · draw with crosshair"
                                : "Region · crop in studio"}
                            </option>
                            <option value="window">Active window</option>
                            <option value="display">
                              Display under cursor
                            </option>
                          </select>
                          <small>
                            {manualCaptureSettings.workflow === "quick" &&
                            manualCaptureSettings.mode === "region"
                              ? "Press the shortcut, then drag around exactly what you want."
                              : manualCaptureSettings.workflow === "quick"
                                ? "Pressing the shortcut captures this target immediately."
                                : "You can change the target each time in Guided Capture."}
                          </small>
                        </label>
                        <label>
                          Global shortcut
                          <HotkeyRecorder
                            workspaceId={workspace?.id || ""}
                            value={manualCaptureSettings.shortcut}
                            platform={platform}
                            onChange={(shortcut) =>
                              setManualCaptureSettings({
                                ...manualCaptureSettings,
                                shortcut,
                              })
                            }
                          />
                          <small>
                            Click the shortcut, then press your preferred key
                            combination.
                          </small>
                        </label>
                        <label>
                          Local retention
                          <select
                            value={manualCaptureSettings.retentionDays}
                            onChange={(event) =>
                              setManualCaptureSettings({
                                ...manualCaptureSettings,
                                retentionDays: Number(event.target.value) as
                                  7 | 30 | 90,
                              })
                            }
                          >
                            <option value="7">7 days</option>
                            <option value="30">30 days</option>
                            <option value="90">90 days</option>
                          </select>
                        </label>
                        <label>
                          Storage limit
                          <select
                            value={manualCaptureSettings.maxCaptures}
                            onChange={(event) =>
                              setManualCaptureSettings({
                                ...manualCaptureSettings,
                                maxCaptures: Number(event.target.value),
                              })
                            }
                          >
                            <option value="50">50 captures</option>
                            <option value="100">100 captures</option>
                            <option value="250">250 captures</option>
                            <option value="500">500 captures</option>
                          </select>
                        </label>
                      </div>
                    </>
                  )}
                  <div className="drawer-actions">
                    <button onClick={() => setScreenCaptureOpen(true)}>
                      Open Guided Capture
                    </button>
                    <button
                      disabled={!workspace || !manualCaptureSettings}
                      onClick={() =>
                        workspace &&
                        manualCaptureSettings &&
                        void window.waypoint
                          .updateScreenCaptureSettings(
                            workspace.id,
                            manualCaptureSettings,
                          )
                          .then(async (saved) => {
                            setManualCaptureSettings(saved);
                            setManualCaptureReadiness(
                              await window.waypoint.screenCaptureReadiness(),
                            );
                            setNotice(saved.shortcutReason);
                          })
                          .catch((reason) => {
                            const message =
                              reason instanceof Error
                                ? reason.message
                                : "Could not save capture settings";
                            setCapturePermissionError(message);
                            showError(reason);
                          })
                      }
                    >
                      Save capture settings
                    </button>
                  </div>
                </section>
                <section id="settings-tools" className="settings-section">
                  <h3>AI Tool Gateway</h3>
                  <p className="drawer-intro">
                    Trusted local commands use the Developer · approve changes
                    profile. This is powerful local authority, not an OS
                    security sandbox: receipts are bounded and redacted, but
                    commands can use your installed tools and local identity.
                    Agent Browser Preview is limited to isolated, user-approved
                    public domains and non-secret navigation actions; PR and
                    deployment tools are not exposed.
                  </p>
                  <div className="automation-boundary warning" role="status">
                    <strong>Installed browsers</strong>
                    <span>
                      {installedBrowsers
                        .map((item) => `${item.label}: ${item.reason}`)
                        .join(" · ") ||
                        "Checking Brave, Chrome, Edge, and Firefox…"}
                    </span>
                  </div>
                  <div
                    className="settings-grid"
                    aria-label="Installed browser profile selection"
                  >
                    <label>
                      Browser application
                      <select
                        aria-label="Installed browser application"
                        value={selectedBrowserId}
                        onChange={(event) => {
                          setSelectedBrowserId(event.target.value);
                          setSelectedBrowserProfile("");
                        }}
                      >
                        {installedBrowsers.map((item) => (
                          <option
                            key={item.id}
                            value={item.id}
                            disabled={!item.selectable}
                          >
                            {item.label}
                            {item.installed ? "" : " · not detected"}
                            {item.family === "firefox" ? " · unavailable" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Profile
                      <select
                        aria-label="Installed browser profile"
                        value={selectedBrowserProfile}
                        onChange={(event) =>
                          setSelectedBrowserProfile(event.target.value)
                        }
                      >
                        <option value="">Choose profile…</option>
                        {installedBrowsers
                          .find((item) => item.id === selectedBrowserId)
                          ?.profiles.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label} · {item.id}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <div className="drawer-actions">
                    <button
                      disabled={!selectedBrowserProfile}
                      onClick={() =>
                        void importBrowserProfile().catch(showError)
                      }
                    >
                      Import private signed-in snapshot
                    </button>
                    {toolSettings?.browserProfileMode === "existing" && (
                      <button
                        className="secondary"
                        onClick={() =>
                          workspace &&
                          void window.waypoint
                            .removeBrowserProfile(workspace.id)
                            .then((result) => {
                              setToolSettings(result.settings);
                              setNotice(
                                "Private browser snapshot removed; Waypoint returned to its isolated profile.",
                              );
                            })
                            .catch(showError)
                        }
                      >
                        Remove private snapshot
                      </button>
                    )}
                  </div>
                  <p className="settings-help">
                    Explicit import copies the selected profile into
                    Waypoint-managed storage; close the source browser first for
                    a consistent snapshot. The source browser is never automated
                    or modified. Ordinary sessions may work under the same
                    browser identity. Passwords, cookies, and Keychain values
                    are never returned to chat, receipts, sync, or the model.
                    Secure password entry remains unavailable.
                  </p>
                  {toolSettings && (
                    <>
                      <div className="automation-boundary" role="status">
                        <strong>
                          {toolSettings.stopped
                            ? "Stopped"
                            : "Ready · local only"}
                        </strong>
                        <span>
                          environment inherited · receipts redacted ·
                          trusted-workspace guardrails
                        </span>
                      </div>
                      <div
                        className={`automation-boundary ${toolCapabilities?.browser.available ? "" : "warning"}`}
                        role="status"
                      >
                        <strong>
                          Agent Browser ·{" "}
                          {toolCapabilities?.browser.available
                            ? "runtime verified"
                            : "unavailable"}
                        </strong>
                        <span>
                          {toolCapabilities?.browser.reason ??
                            "Checking security readiness…"}
                        </span>
                      </div>
                      <label className="settings-field">
                        Browser profile
                        <select
                          aria-label="Agent Browser profile mode"
                          value={toolSettings.browserProfileMode}
                          onChange={(event) =>
                            void saveToolGateway({
                              browserProfileMode: event.target.value as
                                "existing" | "isolated",
                            }).catch(showError)
                          }
                        >
                          <option value="isolated">
                            Waypoint In-App Browser · isolated (default)
                          </option>
                          <option
                            value="existing"
                            disabled={
                              !toolSettings.browserProfileName.includes(".")
                            }
                          >
                            Installed browser · private signed-in snapshot
                          </option>
                        </select>
                      </label>
                      <label className="meeting-consent">
                        Allowed public browser domains (one hostname per line)
                        <textarea
                          aria-label="Allowed browser domains"
                          value={toolSettings.browserAllowedDomains.join("\n")}
                          onChange={(event) =>
                            setToolSettings({
                              ...toolSettings,
                              browserAllowedDomains: event.target.value
                                .split("\n")
                                .map((item) => item.trim())
                                .filter(Boolean),
                            })
                          }
                          rows={3}
                        />
                      </label>
                      <label className="meeting-consent">
                        Deny patterns (one regular expression per line)
                        <textarea
                          value={denyDraft}
                          onChange={(event) => setDenyDraft(event.target.value)}
                          rows={4}
                        />
                      </label>
                      <label className="meeting-consent">
                        <input
                          type="checkbox"
                          checked={toolSettings.suppressCommit}
                          onChange={(event) =>
                            void saveToolGateway({
                              suppressCommit: event.target.checked,
                            }).catch(showError)
                          }
                        />
                        Suppress Git commit for this workspace
                      </label>
                      <label className="meeting-consent">
                        <input
                          type="checkbox"
                          checked={toolSettings.suppressPush}
                          onChange={(event) =>
                            void saveToolGateway({
                              suppressPush: event.target.checked,
                            }).catch(showError)
                          }
                        />
                        Suppress Git push for this workspace
                      </label>
                      <div className="drawer-actions">
                        <button
                          onClick={() =>
                            void saveToolGateway().catch(showError)
                          }
                        >
                          Save policy
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            void saveToolGateway({
                              stopped: !toolSettings.stopped,
                            }).catch(showError)
                          }
                        >
                          {toolSettings.stopped
                            ? "Resume gateway"
                            : "Stop all tools"}
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            workspace &&
                            void window.waypoint
                              .clearToolGatewayBrowserData(workspace.id)
                              .catch(showError)
                          }
                        >
                          Clear isolated browser data
                        </button>
                      </div>
                    </>
                  )}
                  {toolCapabilities && (
                    <dl className="settings-list">
                      {toolCapabilities.localClis.map((item) => (
                        <div key={item.name}>
                          <dt>{item.name}</dt>
                          <dd>
                            {item.available
                              ? "installed · local identity"
                              : "unavailable"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {toolSettings && toolCapabilities && (
                    <div className="settings-panel">
                      <h4>Web Search & Fetch</h4>
                      <div className="automation-boundary" role="status">
                        <strong>Explicit external access</strong>
                        <span>{toolCapabilities.web.reason}</span>
                      </div>
                      <label className="meeting-consent">
                        <input
                          type="checkbox"
                          checked={toolSettings.webFetchEnabled}
                          onChange={(event) =>
                            void updateWebTools({
                              webFetchEnabled: event.target.checked,
                              webSearchEnabled: toolSettings.webSearchEnabled,
                            }).catch(showError)
                          }
                        />
                        Allow bounded HTTPS page fetches for this workspace
                      </label>
                      <label className="meeting-consent">
                        Brave Search API key
                        <input
                          type="password"
                          autoComplete="off"
                          aria-label="Brave Search API key"
                          value={webSearchKey}
                          placeholder={
                            toolCapabilities.web.searchKeyConfigured
                              ? "Protected key stored"
                              : "Required for web search"
                          }
                          onChange={(event) =>
                            setWebSearchKeyDraft(event.target.value)
                          }
                        />
                      </label>
                      <div className="drawer-actions">
                        <button
                          disabled={!webSearchKey}
                          onClick={() =>
                            void window.waypoint
                              .setWebSearchKey(webSearchKey)
                              .then(() => {
                                setWebSearchKeyDraft("");
                                return loadToolGateway();
                              })
                              .catch(showError)
                          }
                        >
                          Store protected search key
                        </button>
                        {toolCapabilities.web.searchKeyConfigured && (
                          <button
                            className="secondary"
                            onClick={() =>
                              void window.waypoint
                                .removeWebSearchKey()
                                .then(loadToolGateway)
                                .catch(showError)
                            }
                          >
                            Remove search key
                          </button>
                        )}
                      </div>
                      <label className="meeting-consent">
                        <input
                          type="checkbox"
                          checked={toolSettings.webSearchEnabled}
                          disabled={!toolCapabilities.web.searchKeyConfigured}
                          onChange={(event) =>
                            void updateWebTools({
                              webFetchEnabled: toolSettings.webFetchEnabled,
                              webSearchEnabled: event.target.checked,
                            }).catch(showError)
                          }
                        />
                        Allow Brave web search for this workspace
                      </label>
                      <small>
                        Fetched pages and snippets are labeled untrusted data.
                        Waypoint blocks localhost, private networks,
                        credentials, non-HTTPS URLs, unsafe redirects, and
                        oversized responses.
                      </small>
                    </div>
                  )}
                  {rollupSettings && (
                    <div className="settings-panel">
                      <h4>Personal cross-workspace roll-ups</h4>
                      <p className="settings-copy">
                        This workspace can see only summary families you
                        explicitly grant. Chat text, document and attachment
                        bodies, credentials, and secrets never cross this
                        boundary.
                      </p>
                      <label className="meeting-consent">
                        <input
                          type="checkbox"
                          checked={rollupSettings.standingEnabled}
                          onChange={(event) =>
                            setRollupSettings({
                              ...rollupSettings,
                              standingEnabled: event.target.checked,
                            })
                          }
                        />
                        Allow standing roll-up requests in this Personal
                        workspace
                      </label>
                      {rollupSettings.availableSources.map((source) => (
                        <fieldset key={source.id}>
                          <legend>{source.name}</legend>
                          {(
                            [
                              "commitments",
                              "meetings",
                              "briefing_status",
                            ] as const
                          ).map((family) => {
                            const grant = rollupSettings.grants.find(
                              (item) =>
                                item.sourceWorkspaceId === source.id &&
                                item.family === family,
                            );
                            return (
                              <label className="meeting-consent" key={family}>
                                <input
                                  type="checkbox"
                                  checked={grant?.enabled ?? false}
                                  onChange={(event) => {
                                    const others = rollupSettings.grants.filter(
                                        (item) =>
                                          !(
                                            item.sourceWorkspaceId ===
                                              source.id &&
                                            item.family === family
                                          ),
                                      ),
                                      next = {
                                        sourceWorkspaceId: source.id,
                                        sourceWorkspaceName: source.name,
                                        family,
                                        enabled: event.target.checked,
                                        createdAt:
                                          grant?.createdAt ??
                                          new Date().toISOString(),
                                        updatedAt: new Date().toISOString(),
                                      };
                                    setRollupSettings({
                                      ...rollupSettings,
                                      grants: [...others, next],
                                    });
                                  }}
                                />
                                {family === "briefing_status"
                                  ? "Briefing/status counts"
                                  : family[0].toUpperCase() + family.slice(1)}
                              </label>
                            );
                          })}
                        </fieldset>
                      ))}
                      <div className="drawer-actions">
                        <button
                          onClick={() =>
                            void saveRollups(rollupSettings).catch(showError)
                          }
                        >
                          Save sharing grants
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            workspace &&
                            void window.waypoint
                              .composeCrossWorkspaceRollup(workspace.id)
                              .then(setRollupPreview)
                              .catch(showError)
                          }
                        >
                          Preview roll-up
                        </button>
                      </div>
                      {rollupPreview && (
                        <div className="automation-boundary" role="status">
                          <strong>
                            {rollupPreview.items.length} summary item
                            {rollupPreview.items.length === 1 ? "" : "s"}
                          </strong>
                          <span>{rollupPreview.provenance}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="activity-list">
                    {toolReceipts.slice(0, 10).map((item) => (
                      <article
                        className="activity-item execution"
                        key={item.id}
                      >
                        <span />
                        <div>
                          <strong>
                            {item.tool} · {item.status}
                          </strong>
                          <small>{item.summary}</small>
                          <small>
                            {new Date(item.startedAt).toLocaleString()} ·{" "}
                            {item.origin} · {item.outputBytes} bytes
                            {item.truncated ? " · truncated" : ""}
                          </small>
                        </div>
                      </article>
                    ))}
                  </div>
                  <h4>Failure prevention</h4>
                  <p className="settings-copy">
                    Equivalent active failures pause before retry. A changed
                    tool/context or an explicit reason allows a truthful retry;
                    success supersedes the warning.
                  </p>
                  <div className="activity-list">
                    {toolFailures.length ? (
                      toolFailures.slice(0, 20).map((item) => (
                        <article
                          className="activity-item execution"
                          key={item.id}
                        >
                          <span />
                          <div>
                            <strong>
                              {item.tool} · {item.outcome}
                            </strong>
                            <small>
                              {item.errorClass}
                              {item.remediation
                                ? ` · remedy: ${item.remediation}`
                                : ""}
                            </small>
                            <small>
                              {item.outcome === "active"
                                ? `Expires ${new Date(item.expiresAt).toLocaleString()}`
                                : `Superseded ${new Date(item.updatedAt).toLocaleString()}`}
                              {item.hadOverride ? " · reasoned retry" : ""}
                            </small>
                          </div>
                          <button
                            className="quiet-button"
                            onClick={() =>
                              void window.waypoint
                                .deleteToolFailure(workspace!.id, item.id)
                                .then(loadToolGateway)
                                .catch(showError)
                            }
                          >
                            Delete
                          </button>
                        </article>
                      ))
                    ) : (
                      <p className="empty-copy">
                        No learned tool failures in this workspace.
                      </p>
                    )}
                  </div>
                </section>
                <section id="settings-voice" className="settings-section">
                  <h3>Voice chat</h3>
                  <p className="drawer-intro">
                    Local voice engines share the same composer control and
                    privacy boundary. Microphone audio is ephemeral and never
                    enters chat, backup, sync, or activity.
                  </p>
                  <div
                    className={`automation-boundary ${voiceCapability?.stt.available ? "" : "warning"}`}
                    role="status"
                  >
                    <strong>
                      {voiceCapability?.stt.available
                        ? "Ready · offline"
                        : "Unavailable"}
                    </strong>
                    <span>
                      {voiceCapability?.stt.reason ??
                        "Checking bundled local speech…"}
                    </span>
                  </div>
                  <label className="settings-field">
                    Voice engine
                    <select
                      aria-label="Voice engine"
                      value={voiceEngine}
                      disabled={voiceState !== "off"}
                      onChange={(event) =>
                        void saveVoicePreferences(
                          voiceMode,
                          voiceDevice,
                          event.target.value as
                            "fast_local" | "full_duplex_experimental",
                        ).catch(showError)
                      }
                    >
                      {voiceEngineStatus?.engines.map((engine) => (
                        <option
                          key={engine.id}
                          value={engine.id}
                          disabled={!engine.ready}
                        >
                          {engine.label}
                          {engine.ready ? "" : " · not ready"}
                        </option>
                      )) ?? <option value="fast_local">Fast Local</option>}
                    </select>
                  </label>
                  {voiceEngineStatus?.engines.map((engine) => (
                    <div
                      className={`automation-boundary ${engine.ready ? "" : "warning"}`}
                      role="status"
                      key={engine.id}
                    >
                      <strong>
                        {engine.label} ·{" "}
                        {engine.ready ? "ready" : "unavailable"}
                      </strong>
                      <span>{engine.reason}</span>
                      <small>
                        {engine.conversationOwner === "waypoint-providers"
                          ? "Uses the selected Waypoint Codex, Claude, or OpenRouter text route."
                          : "Owns its experimental local conversation; Waypoint provider tools are not available."}
                        {engine.packageBytes
                          ? ` · ${(engine.packageBytes / 1024 / 1024).toFixed(1)} MB verified closure`
                          : ""}
                      </small>
                      <small>
                        {engine.metrics.fixture
                          ? "Fixture diagnostics · "
                          : "Measured diagnostics · "}
                        First audio{" "}
                        {engine.metrics.firstAudioMs == null
                          ? "not measured"
                          : `${engine.metrics.firstAudioMs} ms`}{" "}
                        · interruption{" "}
                        {engine.metrics.interruptionMs == null
                          ? "not measured"
                          : `${engine.metrics.interruptionMs} ms`}{" "}
                        · turn end{" "}
                        {engine.metrics.turnEndMs == null
                          ? "not measured"
                          : `${engine.metrics.turnEndMs} ms`}
                      </small>
                      {engine.id === "full_duplex_experimental" &&
                        !engine.ready && (
                          <>
                            <progress
                              aria-label="Experimental voice pack installation progress"
                              value={0}
                              max={100}
                            />
                            <small>
                              Managed pack status: not installed. Exact download
                              size, hardware requirement, license, and first-run
                              cost will be read from a signed production
                              manifest before one-click consent. Resume,
                              integrity verification, atomic activation,
                              rollback, and removal are implemented and
                              fixture-tested; no pack URL is approved in this
                              build.
                            </small>
                            <button
                              type="button"
                              className="secondary"
                              disabled
                              aria-label="Install Experimental Full-Duplex voice pack unavailable"
                            >
                              Install voice pack · unavailable until manifest
                              approval
                            </button>
                          </>
                        )}
                    </div>
                  ))}
                  <label className="settings-field">
                    Default interaction
                    <select
                      aria-label="Default voice mode"
                      value={voiceMode}
                      disabled={voiceState !== "off"}
                      onChange={(event) =>
                        void saveVoicePreferences(
                          event.target.value as VoiceMode,
                          voiceDevice,
                        ).catch(showError)
                      }
                    >
                      <option value="push_to_talk">
                        Push to talk · hold composer control
                      </option>
                      <option value="hands_free">
                        Hands-free · click to enter or exit
                      </option>
                    </select>
                  </label>
                  <label className="settings-field">
                    Microphone
                    <select
                      aria-label="Voice microphone"
                      value={voiceDevice}
                      disabled={voiceState !== "off"}
                      onChange={(event) =>
                        void saveVoicePreferences(
                          voiceMode,
                          event.target.value,
                        ).catch(showError)
                      }
                    >
                      <option value="">System default</option>
                      {voiceDevices.map((device, index) => (
                        <option
                          value={device.deviceId}
                          key={device.deviceId || index}
                        >
                          {device.label || `Microphone ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-field">
                    Reply voice
                    <select aria-label="Voice output" value="system" disabled>
                      <option value="system">Bundled Fast Local voice</option>
                    </select>
                  </label>
                  <p className="settings-help">
                    Hands-free uses local speech/silence detection to end each
                    turn, then resumes after the spoken response. Use headphones
                    to reduce echo. This is not full duplex.
                  </p>
                  <div className="drawer-actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        void loadVoiceCapability().catch(showError)
                      }
                    >
                      Refresh voice diagnostics
                    </button>
                    {voiceState !== "off" && (
                      <button onClick={() => void stopVoiceMode()}>
                        Stop voice now
                      </button>
                    )}
                  </div>
                </section>
                <section
                  id="settings-models"
                  className="settings-section models-settings-section"
                >
                  <header className="model-console-heading">
                    <div>
                      <p>Routing desk</p>
                      <h3>Models & routing</h3>
                      <span>
                        Choose signed-in subscription lanes, map optional hosted
                        roles, and set hard spending limits in one place.
                      </span>
                    </div>
                    {openRouterPresentation && (
                      <span
                        className={`model-status-pill ${openRouterPresentation.tone}`}
                      >
                        <i aria-hidden="true" />
                        {openRouterPresentation.title}
                      </span>
                    )}
                  </header>
                  {openRouter && hostedSettings && (
                    <div className="model-console">
                      <section
                        className="model-settings-block subscription-lanes"
                        aria-labelledby="subscription-lanes-title"
                      >
                        <div className="model-block-heading">
                          <div>
                            <span>Primary lanes</span>
                            <h4 id="subscription-lanes-title">
                              Signed-in subscriptions
                            </h4>
                          </div>
                          <small>Device-local</small>
                        </div>
                        <div className="model-lane-grid">
                          <div className="model-lane-card" role="group" aria-label="Codex model and thinking">
                            <span className="model-lane-label">
                              <i aria-hidden="true">C</i>
                              <span>
                                <strong>Codex</strong>
                                <small>Signed-in CLI</small>
                              </span>
                            </span>
                            <label className="model-choice-field">
                            <span className="sr-only">Codex model preference</span>
                            <select
                              aria-label="Codex model preference"
                              value={chatModels.codex}
                              onChange={(event) =>
                                void changeSubscriptionModel(
                                  "codex",
                                  event.target.value,
                                ).catch(showError)
                              }
                            >
                              {codexModelChoices.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            </label>
                            <ThinkingSelect
                              label="Codex thinking"
                              value={chatThinking.codex}
                              supported={codexModelChoices.find((item) => item.id === chatModels.codex)?.thinking?.supported ?? []}
                              defaultEffort={codexModelChoices.find((item) => item.id === chatModels.codex)?.thinking?.defaultEffort}
                              onChange={(value) => void changeThinking("codex", value).catch(showError)}
                            />
                          </div>
                          <div className="model-lane-card" role="group" aria-label="Claude model and thinking">
                            <span className="model-lane-label">
                              <i aria-hidden="true">A</i>
                              <span>
                                <strong>Claude</strong>
                                <small>Signed-in CLI</small>
                              </span>
                            </span>
                            <label className="model-choice-field">
                            <span className="sr-only">Claude model preference</span>
                            <select
                              aria-label="Claude model preference"
                              value={chatModels.claude}
                              onChange={(event) =>
                                void changeSubscriptionModel(
                                  "claude",
                                  event.target.value,
                                ).catch(showError)
                              }
                            >
                              {claudeModelChoices.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            </label>
                            <ThinkingSelect
                              label="Claude thinking"
                              value={chatThinking.claude}
                              supported={claudeModelChoices.find((item) => item.id === chatModels.claude)?.thinking?.supported ?? []}
                              defaultEffort={claudeModelChoices.find((item) => item.id === chatModels.claude)?.thinking?.defaultEffort}
                              onChange={(value) => void changeThinking("claude", value).catch(showError)}
                            />
                          </div>
                          <div className="model-lane-card" role="group" aria-label="Grok Build model and thinking">
                            <span className="model-lane-label">
                              <i aria-hidden="true">G</i>
                              <span>
                                <strong>Grok Build</strong>
                                <small>Signed-in CLI</small>
                              </span>
                            </span>
                            <label className="model-choice-field">
                            <span className="sr-only">Grok Build model preference</span>
                            <select
                              aria-label="Grok Build model preference"
                              value={chatModels.grok}
                              onChange={(event) =>
                                void changeSubscriptionModel(
                                  "grok",
                                  event.target.value,
                                ).catch(showError)
                              }
                            >
                              {grokModelChoices.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            </label>
                            <ThinkingSelect
                              label="Grok Build thinking"
                              value={chatThinking.grok}
                              supported={grokModelChoices.find((item) => item.id === chatModels.grok)?.thinking?.supported ?? []}
                              defaultEffort={grokModelChoices.find((item) => item.id === chatModels.grok)?.thinking?.defaultEffort}
                              onChange={(value) => void changeThinking("grok", value).catch(showError)}
                            />
                          </div>
                        </div>
                        <p className="model-local-note">
                          These workspace choices also drive the composer. They
                          stay on this device because installed CLI catalogs can
                          differ by machine.
                        </p>
                      </section>

                      <section
                        className={`model-settings-block hosted-lane ${openRouter.usage.summary.capReached ? "is-warning" : ""}`}
                        aria-labelledby="hosted-lane-title"
                      >
                        <div className="model-block-heading">
                          <div>
                            <span>Optional lane</span>
                            <h4 id="hosted-lane-title">OpenRouter</h4>
                          </div>
                          <small>Explicit · may incur cost</small>
                        </div>
                        <div
                          className={`model-route-status ${openRouterPresentation?.tone ?? "quiet"}`}
                          role="status"
                        >
                          <i aria-hidden="true" />
                          <div>
                            <strong>{openRouterPresentation?.title}</strong>
                            <span>{openRouter.capability.reason}</span>
                          </div>
                          <small>{openRouterPresentation?.health}</small>
                        </div>
                        <label className="model-activation-row">
                          <span>
                            <strong>Allow hosted requests</strong>
                            <small>
                              Only when OpenRouter is explicitly selected. No
                              background provider call.
                            </small>
                          </span>
                          <input
                            type="checkbox"
                            aria-label="Allow hosted OpenRouter requests"
                            checked={
                              openRouter.settings.enabled &&
                              openRouter.settings.liveRequestsEnabled
                            }
                            disabled={!openRouter.keyConfigured}
                            onChange={() =>
                              void toggleOpenRouterActivation().catch(showError)
                            }
                          />
                        </label>
                        <div className="model-credential-row">
                          <label className="model-secret-field">
                            <span>Protected API key</span>
                            <input
                              type="password"
                              autoComplete="off"
                              aria-label="OpenRouter API key"
                              placeholder={
                                openRouter.keyConfigured
                                  ? "Protected key stored"
                                  : "Enter an OpenRouter key"
                              }
                              value={openRouterKey}
                              onChange={(event) =>
                                setOpenRouterKeyDraft(event.target.value)
                              }
                            />
                            <small>
                              Stored with OS protection; never backed up,
                              synced, logged, or shown again.
                            </small>
                          </label>
                          <div className="model-credential-actions">
                            <button
                              disabled={!openRouterKey}
                              onClick={() =>
                                void storeOpenRouterKey().catch(showError)
                              }
                            >
                              Store key
                            </button>
                            {openRouter.keyConfigured && (
                              <button
                                className="secondary"
                                onClick={() =>
                                  void window.waypoint
                                    .removeOpenRouterKey()
                                    .then(refreshOpenRouter)
                                    .catch(showError)
                                }
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="model-subheading">
                          <strong>Hosted roles</strong>
                          <span>
                            Used only when the hosted lane is enabled and
                            selected.
                          </span>
                        </div>
                        <div className="model-role-grid attachment-routes">
                          <label className="settings-field model-role-field">
                            <span>Strategic</span>
                            <select
                              aria-label="OpenRouter strategic model"
                              value={hostedSettings.strategicModel}
                              onChange={(event) => {
                                editOpenRouterSettingsDraft({
                                  ...hostedSettings,
                                  strategicModel: event.target.value,
                                });
                                editOpenRouterThinkingDraft((current) => ({
                                  ...current,
                                  openrouterStrategic:
                                    openRouterModelThinking(
                                      event.target.value,
                                    )?.supported.includes(
                                      current.openrouterStrategic as ThinkingEffort,
                                    )
                                      ? current.openrouterStrategic
                                      : "",
                                }));
                              }}
                            >
                              <option value="">Choose a model…</option>
                              {openRouterModelChoices(
                                hostedSettings.strategicModel,
                              ).map((model) => (
                                <option value={model.id} key={model.id}>
                                  {model.name} — {model.id}
                                  {"pricing" in model && model.pricing
                                    ? ` · ${model.pricing}`
                                    : ""}
                                  {model.legacy ? " (saved legacy/custom)" : ""}
                                </option>
                              ))}
                            </select>
                            <small>Planning and coordination</small>
                          </label>
                          <label className="settings-field model-role-field">
                            <span>Everyday</span>
                            <select
                              aria-label="OpenRouter everyday model"
                              value={hostedSettings.everydayModel}
                              onChange={(event) => {
                                editOpenRouterSettingsDraft({
                                  ...hostedSettings,
                                  everydayModel: event.target.value,
                                });
                                editOpenRouterThinkingDraft((current) => ({
                                  ...current,
                                  openrouterEveryday:
                                    openRouterModelThinking(
                                      event.target.value,
                                    )?.supported.includes(
                                      current.openrouterEveryday as ThinkingEffort,
                                    )
                                      ? current.openrouterEveryday
                                      : "",
                                }));
                              }}
                            >
                              <option value="">Choose a model…</option>
                              {openRouterModelChoices(
                                hostedSettings.everydayModel,
                              ).map((model) => (
                                <option value={model.id} key={model.id}>
                                  {model.name} — {model.id}
                                  {"pricing" in model && model.pricing
                                    ? ` · ${model.pricing}`
                                    : ""}
                                  {model.legacy ? " (saved legacy/custom)" : ""}
                                </option>
                              ))}
                            </select>
                            <small>Routine hosted work</small>
                          </label>
                          <label className="settings-field model-role-field">
                            <span>Images</span>
                            <select
                              aria-label="OpenRouter image model"
                              value={hostedSettings.attachmentModel}
                              onChange={(event) => {
                                editOpenRouterSettingsDraft({
                                  ...hostedSettings,
                                  attachmentModel: event.target.value,
                                });
                                editOpenRouterThinkingDraft((current) => ({
                                  ...current,
                                  openrouterAttachment:
                                    openRouterModelThinking(
                                      event.target.value,
                                    )?.supported.includes(
                                      current.openrouterAttachment as ThinkingEffort,
                                    )
                                      ? current.openrouterAttachment
                                      : "",
                                }));
                              }}
                            >
                              <option value="">Choose an image model…</option>
                              {openRouterImageModelChoices(
                                hostedSettings.attachmentModel,
                              ).map((model) => (
                                <option
                                  value={model.id}
                                  key={model.id}
                                  disabled={model.legacy}
                                >
                                  {model.name} — {model.id}
                                  {model.pricing ? ` · ${model.pricing}` : ""}
                                  {model.legacy
                                    ? " (not verified for images)"
                                    : ""}
                                </option>
                              ))}
                            </select>
                            <small>
                              Used only for chats with image pixels; the actual
                              model appears in the timeline and cost receipt.
                            </small>
                          </label>
                        </div>
                        <div
                          className="model-thinking-grid"
                          aria-label="OpenRouter thinking levels"
                        >
                          <ThinkingSelect
                            label="Strategic thinking"
                            value={openRouterThinkingDraft.openrouterStrategic}
                            supported={
                              openRouterModelThinking(
                                hostedSettings.strategicModel,
                              )?.supported ?? []
                            }
                            defaultEffort={
                              openRouterModelThinking(
                                hostedSettings.strategicModel,
                              )?.defaultEffort
                            }
                            onChange={(value) =>
                              editOpenRouterThinkingDraft((current) => ({
                                ...current,
                                openrouterStrategic: value,
                              }))
                            }
                          />
                          <ThinkingSelect
                            label="Everyday thinking"
                            value={openRouterThinkingDraft.openrouterEveryday}
                            supported={
                              openRouterModelThinking(
                                hostedSettings.everydayModel,
                              )?.supported ?? []
                            }
                            defaultEffort={
                              openRouterModelThinking(
                                hostedSettings.everydayModel,
                              )?.defaultEffort
                            }
                            onChange={(value) =>
                              editOpenRouterThinkingDraft((current) => ({
                                ...current,
                                openrouterEveryday: value,
                              }))
                            }
                          />
                          <ThinkingSelect
                            label="Image thinking"
                            value={openRouterThinkingDraft.openrouterAttachment}
                            supported={
                              openRouterModelThinking(
                                hostedSettings.attachmentModel,
                              )?.supported ?? []
                            }
                            defaultEffort={
                              openRouterModelThinking(
                                hostedSettings.attachmentModel,
                              )?.defaultEffort
                            }
                            onChange={(value) =>
                              editOpenRouterThinkingDraft((current) => ({
                                ...current,
                                openrouterAttachment: value,
                              }))
                            }
                          />
                        </div>

                        <div className="model-subheading budget-heading">
                          <strong>Spend guardrails</strong>
                          <span>Caps stop hosted routing before fallback.</span>
                        </div>
                        <div className="provider-cost-grid">
                          <article>
                            <div>
                              <small>This month</small>
                              <strong>
                                {formatProviderMicros(
                                  openRouter.usage.summary.monthMicros,
                                )}
                              </strong>
                            </div>
                            <span>
                              of{" "}
                              {formatProviderMicros(
                                hostedSettings.monthlyCapMicros,
                              )}{" "}
                              · projected{" "}
                              {formatProviderMicros(
                                openRouter.usage.summary.projectedMonthMicros,
                              )}
                            </span>
                            <progress
                              aria-label="Monthly OpenRouter budget used"
                              max={Math.max(
                                1,
                                hostedSettings.monthlyCapMicros,
                              )}
                              value={Math.min(
                                openRouter.usage.summary.monthMicros,
                                Math.max(
                                  1,
                                  hostedSettings.monthlyCapMicros,
                                ),
                              )}
                            />
                          </article>
                          <article>
                            <div>
                              <small>Year to date</small>
                              <strong>
                                {formatProviderMicros(
                                  openRouter.usage.summary.ytdMicros,
                                )}
                              </strong>
                            </div>
                            <span>
                              of{" "}
                              {formatProviderMicros(
                                hostedSettings.ytdCapMicros,
                              )}{" "}
                              ·{" "}
                              {openRouter.usage.summary.capReached
                                ? "cap reached"
                                : openRouter.usage.summary.warning
                                  ? "near warning threshold"
                                  : "within budget"}
                            </span>
                            <progress
                              aria-label="Year-to-date OpenRouter budget used"
                              max={Math.max(
                                1,
                                hostedSettings.ytdCapMicros,
                              )}
                              value={Math.min(
                                openRouter.usage.summary.ytdMicros,
                                Math.max(1, hostedSettings.ytdCapMicros),
                              )}
                            />
                          </article>
                        </div>
                        <div className="settings-grid model-budget-controls">
                          <label>
                            Monthly cap (USD)
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={
                                hostedSettings.monthlyCapMicros / 1_000_000
                              }
                              onChange={(event) =>
                                editOpenRouterSettingsDraft({
                                  ...hostedSettings,
                                  monthlyCapMicros: Math.round(
                                    Number(event.target.value) * 1_000_000,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            YTD cap (USD)
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={
                                hostedSettings.ytdCapMicros / 1_000_000
                              }
                              onChange={(event) =>
                                editOpenRouterSettingsDraft({
                                  ...hostedSettings,
                                  ytdCapMicros: Math.round(
                                    Number(event.target.value) * 1_000_000,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Warn at %
                            <input
                              type="number"
                              min="1"
                              max="100"
                              value={hostedSettings.warningPercent}
                              onChange={(event) =>
                                editOpenRouterSettingsDraft({
                                  ...hostedSettings,
                                  warningPercent: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            Cap fallback
                            <select
                              value={
                                hostedSettings.fallbackProvider ?? "codex"
                              }
                              onChange={(event) =>
                                editOpenRouterSettingsDraft({
                                  ...hostedSettings,
                                  fallbackProvider: event.target.value as
                                    "codex" | "claude" | "grok",
                                })
                              }
                            >
                              <option value="codex">Codex subscription</option>
                              <option value="claude">
                                Claude subscription
                              </option>
                              <option value="grok">
                                Grok Build subscription
                              </option>
                            </select>
                          </label>
                        </div>
                        <div className="model-save-row">
                          <span>
                            Changes to hosted roles and budgets apply after
                            save.
                          </span>
                          <button
                            onClick={() =>
                              void saveOpenRouterSettings().catch(showError)
                            }
                          >
                            Save hosted routing
                          </button>
                        </div>
                        <details className="model-usage-ledger">
                          <summary>
                            <span>Usage ledger</span>
                            <small>
                              {openRouter.usage.summary.byModel.length
                                ? `${openRouter.usage.summary.byModel.length} models · receipt totals`
                                : "No hosted usage receipts"}
                            </small>
                          </summary>
                          <div className="activity-list">
                            {openRouter.usage.summary.byModel.length ? (
                              openRouter.usage.summary.byModel.map((item) => (
                                <article
                                  className="provider-row"
                                  key={item.model}
                                >
                                  <strong>{item.model}</strong>
                                  <span>
                                    {formatProviderMicros(item.costMicros, 4)}
                                  </span>
                                </article>
                              ))
                            ) : (
                              <p className="empty-copy">
                                Setup and status checks make no provider call.
                              </p>
                            )}
                          </div>
                        </details>
                      </section>
                    </div>
                  )}
                </section>
                <section id="settings-sync" className="settings-section">
                  <h3>Secure device sync</h3>
                  <p className="drawer-intro">
                    End-to-end encrypted directly through a desktop host or
                    through the optional Waypoint relay. Keys stay in protected
                    storage on each device.
                  </p>
                  <dl className="settings-list">
                    <div>
                      <dt>Transport</dt>
                      <dd>
                        {desktopSync?.configured
                          ? desktopSync.transportMode === "desktop-host"
                            ? desktopSync.peerHost?.running
                              ? "Desktop host running"
                              : "Desktop host offline"
                            : "Optional hosted relay"
                          : desktopSync?.pendingEnrollment
                            ? "Approval pending"
                            : "Not configured"}
                      </dd>
                    </div>
                    <div>
                      <dt>Key epoch</dt>
                      <dd>{desktopSync?.keyEpoch || "—"}</dd>
                    </div>
                    <div>
                      <dt>Pending changes</dt>
                      <dd>{syncStatus?.pending ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Deletion markers</dt>
                      <dd>{syncStatus?.tombstones ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Local-only attachments</dt>
                      <dd>{syncStatus?.localOnlyAttachments ?? 0}</dd>
                    </div>
                  </dl>
                  {!desktopSync?.configured &&
                    !desktopSync?.pendingEnrollment && (
                      <div className="drawer-actions">
                        <button onClick={() => void initializeSync()}>
                          Set up first device
                        </button>
                        <button
                          className="secondary"
                          onClick={() => void joinSync()}
                        >
                          Join with invitation
                        </button>
                      </div>
                    )}
                  {desktopSync?.pendingEnrollment && (
                    <button onClick={() => void completeSync()}>
                      Complete approved enrollment
                    </button>
                  )}
                  {bootstrapBundle && (
                    <div className="bootstrap-bundle">
                      <p>Public operator bootstrap bundle</p>
                      <textarea readOnly value={bootstrapBundle} />
                      <button
                        className="secondary"
                        onClick={() =>
                          void navigator.clipboard.writeText(bootstrapBundle)
                        }
                      >
                        Copy public bundle
                      </button>
                    </div>
                  )}
                  {desktopSync?.configured && (
                    <>
                      <div className="drawer-actions">
                        {desktopSync.peerHost?.running ? (
                          <button
                            className="secondary"
                            onClick={() =>
                              workspace &&
                              void window.waypoint
                                .stopDesktopSyncHost(workspace.id)
                                .then(() => refresh())
                                .catch(showError)
                            }
                          >
                            Stop desktop host
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              workspace &&
                              void confirmModal({
                                title:
                                  "Host encrypted peer sync on this device?",
                                message:
                                  "Waypoint will listen on your local network. Enrolled peers can connect while this app is awake and running. Public webhooks and offline relay delivery still require the optional hosted relay.",
                                okLabel: "Host on this device",
                              })
                                .then((confirmed) =>
                                  confirmed
                                    ? window.waypoint
                                        .startDesktopSyncHost(workspace.id)
                                        .then(() => refresh())
                                    : undefined,
                                )
                                .catch(showError)
                            }
                          >
                            Host on this device
                          </button>
                        )}
                        <button
                          disabled={inviteBusy}
                          onClick={() => void invitePeer()}
                        >
                          {inviteBusy ? "Creating invite…" : "Invite device"}
                        </button>
                        {desktopSync.rotationTargetEpoch && (
                          <button
                            className="secondary"
                            onClick={() =>
                              workspace &&
                              void window.waypoint
                                .resumeSyncRotation(workspace.id)
                                .then(() => refresh())
                                .catch(showError)
                            }
                          >
                            Resume rotation
                          </button>
                        )}
                      </div>
                      {syncInvitation && (
                        <section
                          className="sync-invitation"
                          aria-label="One-use device invitation"
                        >
                          <div>
                            <strong>Device invitation ready</strong>
                            <span>
                              Expires {new Date(
                                syncInvitation.expiresAt,
                              ).toLocaleTimeString()}
                            </span>
                          </div>
                          <textarea
                            readOnly
                            value={syncInvitation.token}
                            aria-label="One-use enrollment token"
                          />
                          <div className="drawer-actions">
                            <button
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(syncInvitation.token)
                                  .then(() => setNotice("Invitation copied."))
                                  .catch(() =>
                                    setError(
                                      "Clipboard access was denied. Select and copy the visible token manually.",
                                    ),
                                  )
                              }
                            >
                              Copy invitation
                            </button>
                            <button
                              className="secondary"
                              onClick={() => setSyncInvitation(undefined)}
                            >
                              Dismiss
                            </button>
                          </div>
                        </section>
                      )}
                      <p className="settings-help">
                        {desktopSync.peerHost?.reason ??
                          "Desktop hosting is stopped. The hosted relay remains optional for public webhooks, all-peers-offline delivery, and remote reachability."}
                      </p>
                      {desktopSync.peerHost?.running && (
                        <p className="settings-help">
                          Endpoint {desktopSync.peerHost.endpoint} · certificate{" "}
                          is self-signed and must be pinned by senders · SHA-256{" "}
                          {desktopSync.peerHost.fingerprintSha256}
                        </p>
                      )}
                      {pendingPeers.map((item) => (
                        <article className="provider-row" key={item.requestId}>
                          <span>
                            <strong>Pending device</strong>
                            <small>{item.deviceId.slice(0, 12)}…</small>
                          </span>
                          <button
                            onClick={() => void approvePeer(item.requestId)}
                          >
                            Approve
                          </button>
                        </article>
                      ))}
                      {syncDevices.map((item) => (
                        <article className="provider-row" key={item.deviceId}>
                          <span>
                            <strong>
                              {item.role === "owner"
                                ? "This workspace owner"
                                : "Peer device"}
                            </strong>
                            <small>
                              {item.deviceId.slice(0, 12)}… · {item.status}
                            </small>
                          </span>
                          {item.role !== "owner" &&
                            item.status === "active" && (
                              <button
                                onClick={() => void revokePeer(item.deviceId)}
                              >
                                Revoke
                              </button>
                            )}
                        </article>
                      ))}
                    </>
                  )}
                  {desktopSync?.configured && deviceControl && (
                    <div className="device-control-panel">
                      <h4>Trusted device commands</h4>
                      <p className="settings-copy">
                        User-dispatched, encrypted Waypoint commands only. An
                        enrolled peer may decline until its worker policy is
                        enabled. Remote terminal and remote Codex/Claude agents
                        are not enabled in this slice.
                      </p>
                      <div className="drawer-actions">
                        <button onClick={() => void toggleDeviceWorker()}>
                          {deviceControl.policy.enabled
                            ? "Disable this device worker"
                            : "Enable this device worker"}
                        </button>
                      </div>
                      {syncDevices
                        .filter(
                          (item) =>
                            item.status === "active" &&
                            item.deviceId !== desktopSync.deviceId,
                        )
                        .map((item) => (
                          <article
                            className="provider-row"
                            key={`worker-${item.deviceId}`}
                          >
                            <span>
                              <strong>Enrolled peer</strong>
                              <small>{item.deviceId.slice(0, 12)}…</small>
                            </span>
                            <button
                              onClick={() =>
                                void dispatchDeviceSummary(item.deviceId)
                              }
                            >
                              Queue summary
                            </button>
                          </article>
                        ))}
                      <h4>Command history</h4>
                      <div className="activity-list">
                        {deviceControl.jobs.length ? (
                          deviceControl.jobs.slice(0, 20).map((job) => (
                            <article
                              className="activity-item execution"
                              key={job.id}
                            >
                              <span />
                              <div>
                                <strong>
                                  {job.capability} · {job.status}
                                </strong>
                                <small>
                                  {job.resultSummary ??
                                    job.errorCode ??
                                    `Target ${job.targetDeviceId.slice(0, 12)}…`}
                                </small>
                                <small>
                                  {new Date(job.updatedAt).toLocaleString()} ·
                                  lease/status events {job.events.length}
                                </small>
                                <details>
                                  <summary>Execution history</summary>
                                  {job.events.map((event) => (
                                    <small key={event.sequence}>
                                      {event.sequence} · {event.type} ·{" "}
                                      {event.summary}
                                    </small>
                                  ))}
                                </details>
                              </div>
                              {["queued", "leased", "running"].includes(
                                job.status,
                              ) ? (
                                <button
                                  className="quiet-button"
                                  onClick={() =>
                                    workspace &&
                                    void window.waypoint
                                      .cancelDeviceCommand(workspace.id, job.id)
                                      .then(() => refresh())
                                      .catch(showError)
                                  }
                                >
                                  Cancel
                                </button>
                              ) : (
                                <button
                                  className="quiet-button"
                                  onClick={() =>
                                    workspace &&
                                    void confirmModal({
                                      title: "Delete command history?",
                                      message:
                                        "Permanently delete this command history and its sync record?",
                                      okLabel: "Permanently delete",
                                      danger: true,
                                    })
                                      .then((confirmed) =>
                                        confirmed
                                          ? window.waypoint
                                              .deleteDeviceCommand(
                                                workspace.id,
                                                job.id,
                                              )
                                              .then(() => refresh())
                                          : undefined,
                                      )
                                      .catch(showError)
                                  }
                                >
                                  Delete
                                </button>
                              )}
                            </article>
                          ))
                        ) : (
                          <p className="empty-copy">
                            No cross-device commands in this workspace.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </section>
                <section id="settings-backup" className="settings-section">
                  <h3>Backup & recovery</h3>
                  <p className="drawer-intro">
                    Backups are plaintext. Keep them in a protected location.
                  </p>
                  <div className="drawer-actions">
                    <button onClick={() => void exportWorkspace()}>
                      Back up workspace
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void restoreWorkspace()}
                    >
                      Restore backup
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void verifyBackup()}
                    >
                      Verify backup
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void drillBackup()}
                    >
                      Run restore drill
                    </button>
                  </div>
                  <p className="drawer-intro">
                    Verification reads only the selected file. A restore drill
                    uses the real restore path in a temporary local workspace,
                    checks database, files, indexes, and counts, then removes
                    the drill data.
                  </p>
                </section>
                <section id="settings-providers" className="settings-section">
                  <div className="settings-heading-row">
                    <h3>Provider status</h3>
                    <button
                      className="secondary"
                      disabled={providerRefreshBusy}
                      onClick={() =>
                        void refreshCliProviders(true).catch(showError)
                      }
                    >
                      {providerRefreshBusy
                        ? "Refreshing…"
                        : "Refresh providers"}
                    </button>
                  </div>
                  {capabilities.map((item) => (
                    <p className="provider-row" key={item.name}>
                      <strong>{item.name}</strong>
                      <span>
                        {item.available && item.compatible !== false
                          ? item.name === "grok"
                            ? `${grokCatalog ? (grokCatalog.ready ? "Ready" : "Unavailable") : "Checking signed-in account"} · ${item.version ?? "version unknown"} · ${grokCatalog?.reason ?? "Waiting for the installed CLI model inventory"}`
                            : `Ready · ${item.version ?? "version unknown"}`
                          : item.compatibilityError || item.error}
                      </span>
                    </p>
                  ))}
                </section>
                <section id="settings-budgets" className="settings-section">
                  <h3>Recent execution authority</h3>
                  <p className="drawer-intro">
                    Every local run records its approval and authority envelope.
                    Provider-native AI runs continue until completion or
                    explicit cancellation; Waypoint does not cap their tokens,
                    output, or time.
                  </p>
                  {runs.slice(0, 5).map((run) => {
                    const budget = run.budget as
                      Record<string, unknown> | undefined;
                    return budget ? (
                      <p className="provider-row" key={String(run.id)}>
                        <strong>
                          {String(run.cli)} · {String(budget.kind)}
                        </strong>
                        <span>
                          {budget.providerNativeLimits === true
                            ? "Provider-native token, output, and time limits"
                            : `${Math.round(Number(budget.maxDurationMs) / 1000)}s legacy envelope · ${Math.round(Number(budget.maxOutputBytes) / 1024 / 1024)} MiB legacy output`}{" "}
                          · 1 attempt ·{" "}
                          {String(budget.approvalOrigin).replaceAll("-", " ")}
                        </span>
                      </p>
                    ) : null;
                  })}
                  {!runs.some((run) => run.budget) && (
                    <p className="drawer-empty">
                      No budgeted run has been recorded yet.
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}
          {drawer === "automations" && (
            <div className="drawer-body">
              <p className="drawer-intro">
                Provider webhooks enter one authenticated, encrypted queue and
                remain quarantined until they match an explicitly approved rule.
                AI-created configurations are digest-bound and cannot provision
                a provider or start a model before you approve them.
              </p>
              <section>
                <h3>
                  AI proposals <span>{automationProposals.length}</span>
                </h3>
                {!automationProposals.length && (
                  <p className="drawer-empty">
                    Ask chat to create a webhook automation, or configure an
                    inbound channel below.
                  </p>
                )}
                {automationProposals.map((proposal) => (
                  <article
                    className={`playbook-item ${proposal.status}`}
                    key={proposal.id}
                  >
                    <header>
                      <div>
                        <small>
                          {proposal.status} ·{" "}
                          {proposal.definition.trigger.connectorId.replaceAll(
                            "_",
                            " ",
                          )}
                        </small>
                        <strong>{proposal.title}</strong>
                        <small>
                          {proposal.definition.trigger.eventType} ·{" "}
                          {proposal.definition.action.provider}
                          {proposal.definition.action.model
                            ? ` / ${proposal.definition.action.model}`
                            : ""}{" "}
                          · profile{" "}
                          {proposal.definition.action.securityProfileId} · runs
                          until completion or cancellation
                        </small>
                        <span>
                          Filters{" "}
                          {Object.keys(proposal.definition.trigger.filters)
                            .length
                            ? JSON.stringify(
                                proposal.definition.trigger.filters,
                              )
                            : "none"}
                        </span>
                        <span>
                          Endpoint{" "}
                          {proposal.definition.delivery.endpoint ??
                            "not configured"}{" "}
                          · channel{" "}
                          {proposal.definition.delivery.channelId ??
                            "not configured"}
                        </span>
                        <span>
                          Provisioning{" "}
                          {proposal.definition.provisioning.mode.replaceAll(
                            "_",
                            " ",
                          )}{" "}
                          ·{" "}
                          {[
                            proposal.definition.provisioning.organization,
                            proposal.definition.provisioning.project,
                            proposal.definition.provisioning
                              .repositoryFullName ??
                              proposal.definition.provisioning.repository,
                            proposal.definition.provisioning.targetBranch,
                          ]
                            .filter(Boolean)
                            .join(" / ") || "no provider target"}{" "}
                          · stable IDs{" "}
                          {[
                            proposal.definition.provisioning.projectId,
                            proposal.definition.provisioning.repositoryId,
                          ]
                            .filter(Boolean)
                            .join(" / ") || "not applicable"}
                        </span>
                        <span>
                          Instruction: {proposal.definition.action.instruction}
                        </span>
                        <span>Digest {proposal.proposalDigest}</span>
                        {proposal.definition.provisioning.commandPreview && (
                          <span>
                            {proposal.definition.provisioning.commandPreview}
                          </span>
                        )}
                        {proposal.receipt && (
                          <>
                            <span>
                              {String(
                                proposal.receipt.externalMutation.summary ??
                                  proposal.receipt.externalMutation.reason ??
                                  "Decision recorded",
                              )}
                            </span>
                            <details>
                              <summary>Audit trail and rollback</summary>
                              <pre>
                                {JSON.stringify(
                                  {
                                    rollback:
                                      proposal.receipt.externalMutation
                                        .rollback ??
                                      "No external cleanup required",
                                    externalId:
                                      proposal.receipt.externalMutation
                                        .externalId,
                                    delivery:
                                      proposal.receipt.externalMutation
                                        .delivery,
                                    events:
                                      proposal.receipt.provisioningEvents ?? [],
                                  },
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          </>
                        )}
                      </div>
                    </header>
                    {proposal.question?.status === "pending" && (
                      <div className="meeting-actions">
                        <button
                          onClick={() =>
                            void decideAutomationProposal(
                              proposal,
                              "reject",
                            ).catch(showError)
                          }
                        >
                          Reject
                        </button>
                        <button
                          onClick={() =>
                            void decideAutomationProposal(
                              proposal,
                              "approve",
                            ).catch(showError)
                          }
                        >
                          Approve and provision
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </section>
              <section>
                <h3>
                  Active rules and runs{" "}
                  <span>
                    {automationRuntime.rules.length} /{" "}
                    {automationRuntime.runs.length}
                  </span>
                </h3>
                {!automationRuntime.rules.length && (
                  <p className="drawer-empty">
                    No approved webhook rule is enabled.
                  </p>
                )}
                {automationRuntime.rules.map((rule) => (
                  <article
                    className={`playbook-item ${rule.status}`}
                    key={rule.id}
                  >
                    <header>
                      <div>
                        <small>
                          {rule.status} ·{" "}
                          {rule.connectorId.replaceAll("_", " ")}
                        </small>
                        <strong>{rule.eventType}</strong>
                        <span>
                          {Object.keys(rule.filters).length
                            ? JSON.stringify(rule.filters)
                            : "All authenticated events of this type"}{" "}
                          · channel {rule.channelId.slice(0, 10)}…
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          void setAutomationRuleEnabled(
                            rule.id,
                            rule.status !== "enabled",
                          ).catch(showError)
                        }
                      >
                        {rule.status === "enabled" ? "Stop" : "Resume"}
                      </button>
                    </header>
                  </article>
                ))}
                {automationRuntime.runs.slice(0, 20).map((run) => (
                  <article
                    className={`playbook-item ${run.status}`}
                    key={run.id}
                  >
                    <header>
                      <div>
                        <small>
                          {run.status} ·{" "}
                          {new Date(run.createdAt).toLocaleString()}
                        </small>
                        <strong>
                          {run.resultSummary ?? "Webhook-triggered AI review"}
                        </strong>
                        {run.errorCode && <span>{run.errorCode}</span>}
                      </div>
                      <div className="automation-run-actions">
                        {run.chatId && (
                          <button onClick={() => openChatTab(run.chatId!)}>
                            Open chat
                          </button>
                        )}
                        {(run.status === "queued" ||
                          run.status === "running") && (
                          <button
                            onClick={() =>
                              void cancelAutomationRun(run.id).catch(showError)
                            }
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </header>
                  </article>
                ))}
              </section>
              <section>
                <h3>
                  Signed inbound <span>{webhookEvents.length}</span>
                </h3>
                {!webhookChannels && (
                  <p className="drawer-empty">
                    Set up and enroll desktop sync before creating a production
                    inbound channel.
                  </p>
                )}
                {webhookChannels && (
                  <>
                    <div className="automation-boundary" role="status">
                      <strong>
                        {webhookChannels.managementState === "unknown"
                          ? "Inbound management state unknown"
                          : !webhookChannels.reachable
                            ? "Inbound host unavailable"
                            : webhookChannels.killSwitch
                              ? "Inbound kill switch active"
                              : "Encrypted inbound enabled"}
                      </strong>
                      <span>
                        {webhookChannels.reason} ·{" "}
                        {webhookChannels.reachability.replaceAll("-", " ")} ·{" "}
                        {webhookChannels.transportMode.replaceAll("-", " ")} ·
                        authenticated · replay protected · encrypted queue
                      </span>
                      {webhookChannels.fingerprintSha256 && (
                        <code>
                          Self-signed certificate SHA-256{" "}
                          {webhookChannels.fingerprintSha256}
                        </code>
                      )}
                    </div>
                    <div className="drawer-actions">
                      <button
                        disabled={
                          !webhookChannels.reachable ||
                          webhookChannels.managementState === "unknown"
                        }
                        onClick={() =>
                          void createWebhookChannel().catch(showError)
                        }
                      >
                        New inbound channel
                      </button>
                      <button
                        disabled={
                          !webhookChannels.reachable ||
                          webhookChannels.managementState === "unknown"
                        }
                        onClick={() =>
                          void refreshWebhookEvents().catch(showError)
                        }
                      >
                        Fetch inbound
                      </button>
                      <button
                        className="secondary"
                        disabled={
                          !webhookChannels.reachable ||
                          webhookChannels.managementState === "unknown"
                        }
                        onClick={() =>
                          void window.waypoint
                            .setWebhookKill(
                              workspace!.id,
                              !webhookChannels.killSwitch,
                            )
                            .then(() =>
                              window.waypoint.webhookChannels(workspace!.id),
                            )
                            .then(setWebhookChannels)
                            .catch(showError)
                        }
                      >
                        {webhookChannels.managementState === "unknown"
                          ? "Kill switch unavailable"
                          : webhookChannels.killSwitch
                            ? "Resume inbound"
                            : "Kill inbound"}
                      </button>
                      {webhookChannels.certificatePem && (
                        <button
                          className="secondary"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(
                                JSON.stringify(
                                  {
                                    trust: "self-signed-pinned",
                                    certificatePem:
                                      webhookChannels.certificatePem,
                                    fingerprintSha256:
                                      webhookChannels.fingerprintSha256,
                                  },
                                  null,
                                  2,
                                ),
                              )
                              .then(() =>
                                setNotice(
                                  "Pinned desktop-host certificate and full SHA-256 fingerprint copied.",
                                ),
                              )
                              .catch(showError)
                          }
                        >
                          Copy TLS trust
                        </button>
                      )}
                    </div>
                  </>
                )}
                {webhookChannels?.channels.map((channel) => (
                  <article
                    className={`playbook-item ${channel.status}`}
                    key={channel.channelId}
                  >
                    <header>
                      <div>
                        <small>
                          {channel.status} ·{" "}
                          {channel.connectorId.replaceAll("_", " ")} ·{" "}
                          {channel.authMode.replaceAll("_", " ")} · secret v
                          {channel.secretVersion}
                        </small>
                        <strong>{channel.label}</strong>
                        <small>
                          Channel {channel.channelId.slice(0, 10)}… · recipient{" "}
                          {channel.recipientDeviceId.slice(0, 10)}…
                        </small>
                        <span>
                          The signing secret is protected and cannot be
                          displayed again. Rotate to issue a replacement.
                        </span>
                      </div>
                    </header>
                    <div className="meeting-actions">
                      <button
                        disabled={channel.status !== "active"}
                        onClick={() =>
                          void rotateWebhookChannel(channel.channelId).catch(
                            showError,
                          )
                        }
                      >
                        Rotate
                      </button>
                      <button
                        disabled={channel.status !== "active"}
                        onClick={() =>
                          void window.waypoint
                            .revokeWebhookChannel(
                              workspace!.id,
                              channel.channelId,
                            )
                            .then(() =>
                              window.waypoint.webhookChannels(workspace!.id),
                            )
                            .then(setWebhookChannels)
                            .catch(showError)
                        }
                      >
                        Revoke
                      </button>
                      <button
                        onClick={() =>
                          void window.waypoint
                            .deleteWebhookChannel(
                              workspace!.id,
                              channel.channelId,
                            )
                            .then(() =>
                              window.waypoint.webhookChannels(workspace!.id),
                            )
                            .then(setWebhookChannels)
                            .catch(showError)
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
                {webhookEvents.map((event) => (
                  <article className="playbook-item paused" key={event.id}>
                    <header>
                      <div>
                        <small>
                          quarantined · untrusted ·{" "}
                          {event.runCount
                            ? `${event.runCount} automation run${event.runCount === 1 ? "" : "s"} · ${event.runStatus}`
                            : "unmatched · no automation run"}
                        </small>
                        <strong>{event.eventType}</strong>
                        <small>
                          Channel {event.channelId.slice(0, 10)}… · payload{" "}
                          {event.payloadDigest.slice(0, 10)}…
                        </small>
                        <span>{JSON.stringify(event.payload)}</span>
                      </div>
                      <button
                        onClick={() =>
                          void deleteWebhookEvent(event.id).catch(showError)
                        }
                      >
                        Delete
                      </button>
                    </header>
                  </article>
                ))}
              </section>
            </div>
          )}
        </aside>
      )}
      {tabMenu && (
        <>
          <button
            className="tab-menu-scrim"
            aria-label="Close tab actions"
            onClick={() => setTabMenu(undefined)}
          />
          <div
            className="tab-context-menu"
            role="menu"
            aria-label="Tab actions"
            style={{ left: tabMenu.x, top: tabMenu.y }}
          >
            <button
              role="menuitem"
              onClick={() => closeTab(tabMenu.tabId, "close")}
            >
              Close
            </button>
            <button
              role="menuitem"
              onClick={() => closeTab(tabMenu.tabId, "close-others")}
            >
              Close others
            </button>
            <button
              role="menuitem"
              disabled={
                mainTabs.findIndex((tab) => tab.id === tabMenu.tabId) ===
                mainTabs.length - 1
              }
              onClick={() => closeTab(tabMenu.tabId, "close-right")}
            >
              Close tabs to the right
            </button>
            <div className="tab-menu-divider" />
            <button
              role="menuitem"
              onClick={() => closeTab(tabMenu.tabId, "close-all")}
            >
              Close all
            </button>
          </div>
        </>
      )}
      {attachmentViewer && (
        <div
          className="attachment-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={`Image preview: ${attachmentViewer.name}`}
        >
          <header>
            <strong>{attachmentViewer.name}</strong>
            <small>
              {attachmentViewer.width} × {attachmentViewer.height}
            </small>
            <button
              type="button"
              autoFocus
              aria-label="Close image preview"
              onClick={() => setAttachmentViewer(undefined)}
            >
              ×
            </button>
          </header>
          <div>
            <img
              src={attachmentViewer.dataUrl}
              alt={`Full image attachment: ${attachmentViewer.name}`}
            />
          </div>
        </div>
      )}
      {screenCaptureOpen && workspace && (
        <ScreenCaptureStudio
          key={workspace.id}
          workspaceId={workspace.id}
          chatId={selectedChatId}
          defaultMode={manualCaptureSettings?.mode ?? "region"}
          onClose={() => setScreenCaptureOpen(false)}
          onNotice={setNotice}
          onAddedToChat={(chatId, attachment) => {
            if (
              selectedChatId !== chatId ||
              workspace.id !== attachment.workspaceId
            )
              return;
            setAttachments((items) =>
              items.some((item) => item.id === attachment.id)
                ? items
                : [...items, attachment],
            );
            setNotice("");
            setScreenCaptureOpen(false);
          }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
