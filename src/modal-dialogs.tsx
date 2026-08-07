import { useEffect, useRef, useState, type FormEvent } from "react";

type AlertRequest = {
  kind: "alert";
  title: string;
  message?: string;
  okLabel?: string;
  resolve: (value: null) => void;
};
type ConfirmRequest = {
  kind: "confirm";
  title: string;
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
};
type PromptRequest = {
  kind: "prompt";
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  maxLength?: number;
  resolve: (value: string | null) => void;
};
type DialogRequest = AlertRequest | ConfirmRequest | PromptRequest;

const queue: DialogRequest[] = [];
let notifyHost: (() => void) | undefined;

function enqueue(request: DialogRequest) {
  queue.push(request);
  notifyHost?.();
}

export function alertModal(options: {
  title: string;
  message?: string;
  okLabel?: string;
}): Promise<void> {
  return new Promise((resolve) =>
    enqueue({ kind: "alert", ...options, resolve: () => resolve() }),
  );
}

export function confirmModal(options: {
  title: string;
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => enqueue({ kind: "confirm", ...options, resolve }));
}

export function promptModal(options: {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  maxLength?: number;
}): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: "prompt", ...options, resolve }));
}

export function ModalDialogHost() {
  const [, setRevision] = useState(0),
    dialogRef = useRef<HTMLElement>(null);
  const current = queue[0];
  useEffect(() => {
    notifyHost = () => setRevision((value) => value + 1);
    return () => {
      notifyHost = undefined;
    };
  }, []);
  useEffect(() => {
    if (!current) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current
      ?.querySelector<HTMLElement>("input,textarea,button[data-confirm]")
      ?.focus();
    return () => previous?.focus?.();
  }, [current]);
  if (!current) return null;
  function finish(value: string | boolean | null) {
    const settled = queue.shift();
    setRevision((revision) => revision + 1);
    if (!settled) return;
    if (settled.kind === "confirm") settled.resolve(Boolean(value));
    else if (settled.kind === "prompt")
      settled.resolve(typeof value === "string" ? value : null);
    else settled.resolve(null);
  }
  const cancelValue = current.kind === "confirm" ? false : null;
  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    finish(String(new FormData(event.currentTarget).get("value") ?? ""));
  }
  return (
    <div
      className="workspace-dialog-scrim modal-dialog-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) finish(cancelValue);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(cancelValue);
        }
      }}
    >
      <section
        ref={dialogRef}
        className="workspace-dialog modal-dialog"
        role={current.kind === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="modal-dialog-title"
      >
        <h2 id="modal-dialog-title">{current.title}</h2>
        {current.message && <p className="modal-dialog-message">{current.message}</p>}
        {current.kind === "prompt" ? (
          <form onSubmit={submitPrompt}>
            <label>
              <span className="sr-only">{current.title}</span>
              {current.multiline ? (
                <textarea
                  name="value"
                  defaultValue={current.defaultValue ?? ""}
                  placeholder={current.placeholder}
                  maxLength={current.maxLength}
                  rows={6}
                />
              ) : (
                <input
                  name="value"
                  defaultValue={current.defaultValue ?? ""}
                  placeholder={current.placeholder}
                  maxLength={current.maxLength}
                />
              )}
            </label>
            <div>
              <button type="button" onClick={() => finish(null)}>
                {current.cancelLabel ?? "Cancel"}
              </button>
              <button type="submit">{current.okLabel ?? "OK"}</button>
            </div>
          </form>
        ) : (
          <div>
            {current.kind === "confirm" && (
              <button type="button" onClick={() => finish(false)}>
                {current.cancelLabel ?? "Cancel"}
              </button>
            )}
            <button
              type="button"
              data-confirm
              className={
                current.kind === "confirm" && current.danger ? "danger" : "primary"
              }
              onClick={() => finish(current.kind === "confirm" ? true : null)}
            >
              {current.okLabel ?? (current.kind === "confirm" ? "Confirm" : "OK")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
