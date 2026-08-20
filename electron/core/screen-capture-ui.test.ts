import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../../src/screen-capture.css", import.meta.url),
  "utf8",
);
const component = readFileSync(
  new URL("../../src/screen-capture-studio.tsx", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../../src/main.tsx", import.meta.url),
  "utf8",
);
const app = settings;
const compactApp = app.replace(/\s+/g, "");
const recorder = readFileSync(
  new URL("../../src/hotkey-recorder.tsx", import.meta.url),
  "utf8",
);

describe("screen capture visual workspace", () => {
  it("keeps the modal bounded and responsive at narrow and short viewports", () => {
    expect(styles).toMatch(/max-height: calc\(100dvh/);
    expect(styles).toMatch(/@media \(max-width: 760px\)/);
    expect(styles).toMatch(/@media \(max-height: 620px\)/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(styles).toMatch(
      /grid-template-rows: auto auto auto minmax\(0, 1fr\) auto/,
    );
    expect(styles).toMatch(/\.capture-canvas-wrap \{[\s\S]*min-height: 0/);
    expect(styles).toMatch(
      /\.capture-editor > footer \{[\s\S]*env\(safe-area-inset-bottom\)/,
    );
    expect(styles).not.toMatch(/\.capture-canvas-wrap \{[^}]*max-height:/);
  });

  it("provides visible keyboard focus and distinct error, canvas, and destructive states", () => {
    expect(styles).toMatch(/\.capture-overlay button:focus-visible/);
    expect(styles).toMatch(/\.capture-error::before/);
    expect(styles).toMatch(/\.capture-canvas-wrap::before/);
    expect(styles).toMatch(/\.capture-preview-actions button\.danger/);
  });

  it("keeps every post-capture action visible in the polished ready state", () => {
    for (const label of [
      "Copy",
      "Save locally",
      "Annotate",
      "Add to Knowledge",
      "Discard",
    ]) {
      expect(component).toContain(`>${label}<`);
    }
    expect(component).toContain('aria-label="Screenshot quick actions"');
    expect(component).toContain(
      'autoFocus aria-label="Close screenshot preview"',
    );
    expect(component).toContain(
      "sources.length&&!captures.some((item)=>item.id===capture.id)",
    );
    expect(component).toContain('className="capture-ready-image"');
    expect(component).toContain("Local preview · nothing has been shared");
  });

  it("hands Add to Chat directly to the active composer without a success toast", () => {
    expect(component).toContain("async function addToChat(captureId:string)");
    expect(component).toContain(
      "onAddedToChat(target.chatId,result.attachment)",
    );
    expect(component).toContain(
      "attachingCaptureId===capture.id?'Adding…':'Add to Chat'",
    );
    expect(component).toContain(
      "Start or select a chat before adding this screenshot.",
    );
    expect(component).toContain("Could not add screenshot to chat.");
    expect(component).not.toContain("Screenshot queued in this chat");
    expect(compactApp).toContain(
      "setAttachments((items)=>items.some((item)=>item.id===attachment.id)?items:[...items,attachment],)",
    );
  });

  it("renders protected image thumbnails, a safe viewer, and pasted images", () => {
    expect(app).toContain("function ChatAttachmentPreview");
    expect(app).toContain(
      'attachmentImagePreview(workspaceId, attachment.id, "thumbnail")',
    );
    expect(app).toContain("alt={`Image attachment: ${attachment.name}`}");
    expect(app).toContain("aria-label={`Open full image ${attachment.name}`}");
    expect(app).toContain("Image missing or corrupt");
    expect(app).toContain("onPaste={(event) => void pasteChatImages(event)}");
    expect(app).toContain("addPastedChatImage");
  });

  it("provides an equivalent keyboard annotation path", () => {
    expect(component).toContain(
      'role="dialog" aria-modal="true" aria-label="Screenshot annotation editor"',
    );
    expect(component).toContain(
      'tabIndex={0} aria-label="Screenshot annotation canvas"',
    );
    expect(component).toContain("onKeyDown={keyCanvas}");
    expect(component).toContain("onClick={()=>void addCentered()}");
    expect(component).toContain('aria-label="Selected annotation layer"');
    expect(component).toContain("Hold Shift with arrow keys to resize");
    for (const label of ["Discard changes", "Save layers", "Done · flatten"])
      expect(component).toContain(`>${label}<`);
    expect(component).toContain('className="capture-editor-actions"');
    expect(component).toContain("onSaved(saved);onClose()");
  });

  it("retains explicit privacy and independent-copy redaction messaging", () => {
    expect(component).toContain("Nothing is uploaded or sent to a model.");
    expect(component).toContain("existing copies remain independent");
  });

  it("offers guided and quick workflows with a recordable Windows shortcut", () => {
    expect(settings).toContain('aria-label="Shortcut behavior"');
    expect(settings).toContain("Guided capture");
    expect(settings).toContain("Quick capture");
    expect(settings).toContain("Region · draw with crosshair");
    expect(settings).toContain("<HotkeyRecorder");
    expect(recorder).toContain("platform === 'win32' ? 'PrintScreen'");
    expect(recorder).toContain("event.code.slice(5)");
    expect(recorder).toContain("')!@#$%^&*('.indexOf(event.key)");
  });
});
