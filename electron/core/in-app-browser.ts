import { BrowserWindow, WebContentsView } from "electron";
import path from "node:path";
import{realpathSync,statSync}from'node:fs';
import{createHash}from'node:crypto';
import {
  createBrowserNetworkGate,
  domainAllowed,
  resolvePublicBrowserDomains,
  type BrowserAction,
} from "./agent-browser.js";
type State = {
  workspaceId: string;
  url: string;
  title: string;
  loading: boolean;
  error?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  profile: "Waypoint isolated";
  open: boolean;
};
type Entry = {
  view: WebContentsView;
  host: BrowserWindow;
  gate: Awaited<ReturnType<typeof createBrowserNetworkGate>>;
  domains: string[];
  state: State;
  attached: boolean;
};
export const inAppBrowserWebPreferences = (partition: string) => ({
  partition,
  sandbox: true,
  nodeIntegration: false,
  contextIsolation: true,
  // Contained mode does not execute untrusted page JavaScript. This closes
  // WebRTC/WebTransport/direct-socket bypasses that do not traverse webRequest.
  javascript: false,
  disableBlinkFeatures: "WebRTC,WebTransport,DirectSockets",
});
const safeUrl = (value: string, domains: string[]) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("browser_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !domainAllowed(url.hostname, domains)
  )
    throw new Error("browser_url_denied");
  return url.href;
};
export class InAppBrowserController {
  private entries = new Map<string, Entry>();
  constructor(
    private readonly notify: (workspaceId: string, state: State) => void,
  ) {}
  private emit(entry: Entry) {
    entry.state = {
      ...entry.state,
      url: entry.view.webContents.getURL() || entry.state.url,
      title: entry.view.webContents.getTitle() || entry.state.title,
      loading: entry.view.webContents.isLoading(),
      canGoBack: entry.view.webContents.navigationHistory.canGoBack(),
      canGoForward: entry.view.webContents.navigationHistory.canGoForward(),
    };
    this.notify(entry.state.workspaceId, entry.state);
    return entry.state;
  }
  private abortable<T>(
    entry: Entry,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ) {
    if (!signal) return operation();
    if (signal.aborted) return Promise.reject(new DOMException("Canceled", "AbortError"));
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          callback();
        },
        abort = () => {
          entry.view.webContents.stop();
          finish(() => reject(new DOMException("Canceled", "AbortError")));
        };
      signal.addEventListener("abort", abort, { once: true });
      void operation().then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }
  private async evaluate(entry: Entry, expression: string) {
    const debuggerApi = entry.view.webContents.debugger;
    if (!debuggerApi.isAttached()) debuggerApi.attach("1.3");
    try {
      const result = await debuggerApi.sendCommand("Runtime.evaluate", {
        expression,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error("browser_page_action_failed");
      return result.result?.value;
    } finally {
      if (debuggerApi.isAttached()) debuggerApi.detach();
    }
  }
  async open(
    workspaceId: string,
    host: BrowserWindow,
    url: string,
    domains: string[],
    bounds: { x: number; y: number; width: number; height: number },
    signal?: AbortSignal,
  ) {
    await this.close(workspaceId);
    const href = safeUrl(url, domains);
    await resolvePublicBrowserDomains([new URL(href).hostname]);
    const gate = await createBrowserNetworkGate(domains),
      view = new WebContentsView({
        webPreferences: inAppBrowserWebPreferences(
          `waypoint-inapp-${workspaceId}-${Date.now()}`,
        ),
      }),
      state: State = {
        workspaceId,
        url: href,
        title: "Waypoint In-App Browser",
        loading: true,
        canGoBack: false,
        canGoForward: false,
        profile: "Waypoint isolated",
        open: true,
      },
      entry = { view, host, gate, domains, state, attached: true };
    this.entries.set(workspaceId, entry);
    await view.webContents.session.setProxy({ proxyRules: gate.url });
    view.webContents.session.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    view.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      try {
        const target = new URL(details.url);
        callback({
          cancel:
            target.protocol !== "https:" ||
            !domainAllowed(target.hostname, domains),
        });
      } catch {
        callback({ cancel: true });
      }
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event, target) => {
      try {
        safeUrl(target, domains);
      } catch {
        event.preventDefault();
        entry.state.error =
          "Navigation was blocked by the public-domain policy.";
        this.emit(entry);
      }
    });
    view.webContents.on("did-start-loading",()=>this.emit(entry));
    view.webContents.on("did-stop-loading",()=>this.emit(entry));
    view.webContents.on("page-title-updated",()=>this.emit(entry));
    view.webContents.on("did-navigate",()=>this.emit(entry));
    view.webContents.on("did-navigate-in-page",()=>this.emit(entry));
    view.webContents.on("did-fail-load", (_event, _code, description) => {
      entry.state.error = description;
      this.emit(entry);
    });
    host.contentView.addChildView(view);
    this.bounds(workspaceId, bounds);
    await this.abortable(entry, signal, () => view.webContents.loadURL(href));
    return this.emit(entry);
  }
  bounds(
    workspaceId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) {
    const entry = this.entries.get(workspaceId);
    if (!entry) return;
    if (!entry.attached) {
      entry.host.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    const [width, height] = entry.host.getContentSize(),
      x = Math.max(0, Math.min(width - 100, Math.round(bounds.x))),
      y = Math.max(0, Math.min(height - 100, Math.round(bounds.y))),
      w = Math.max(100, Math.min(width - x, Math.round(bounds.width))),
      h = Math.max(100, Math.min(height - y, Math.round(bounds.height)));
    entry.view.setBounds({ x, y, width: w, height: h });
  }
  status(workspaceId: string) {
    const entry = this.entries.get(workspaceId);
    return entry
      ? this.emit(entry)
      : {
          workspaceId,
          url: "",
          title: "Waypoint In-App Browser",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          profile: "Waypoint isolated" as const,
          open: false,
        };
  }
  async action(workspaceId: string, action: BrowserAction,workspaceRoot:string|undefined,signal:AbortSignal) {
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    const entry = this.entries.get(workspaceId);
    if (!entry) throw new Error("browser_surface_closed");
    const wc = entry.view.webContents,
      run = <T>(operation: () => Promise<T>) =>
        this.abortable(entry, signal, operation);
    if (action.command === "open") {
      await run(() => wc.loadURL(safeUrl(action.url, entry.domains)));
      return {
        summary: "Opened URL in Waypoint In-App Browser",
        output: entry.view.webContents.getURL(),
      };
    }
    if (action.command === "snapshot") {
      const output = await run(() => this.evaluate(entry,
        `(()=>{let n=0;const safe=(s)=>String(s||'').replace(/\\s+/g,' ').trim().slice(0,500);const interactive=[...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[tabindex]')].slice(0,500).filter(e=>!(e instanceof HTMLInputElement&&e.type==='password')).map(e=>{const ref='@e'+(++n);e.setAttribute('data-waypoint-ref',ref);return{ref,role:e.getAttribute('role')||e.tagName.toLowerCase(),label:safe(e.getAttribute('aria-label')||e.textContent||e.getAttribute('placeholder'))}});return JSON.stringify({url:location.href,title:document.title,text:safe(document.body?.innerText).slice(0,50000),interactive})})()`,
      ));
      return {
        summary: "Captured bounded in-app page snapshot",
        output: String(output).slice(0, 65_536),
      };
    }
    const selector = "ref" in action ? `[data-waypoint-ref=${JSON.stringify(action.ref)}]` : "";
    if (action.command === "click") {
      await run(() => this.evaluate(entry,
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('browser_ref_missing');e.click()})()`,
      ));
      return { summary: `Clicked ${action.ref}` };
    }
    if (action.command === "type") {
      await run(() => this.evaluate(entry,
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement)||e instanceof HTMLInputElement&&e.type==='password')throw new Error('browser_secure_input_unavailable');e.focus();e.value=${JSON.stringify(action.text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
      ));
      return { summary: `Entered ordinary non-secret text in ${action.ref}` };
    }
    if (action.command === "select") {
      await run(() => this.evaluate(entry,
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!(e instanceof HTMLSelectElement))throw new Error('browser_select_invalid');e.value=${JSON.stringify(action.value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
      ));
      return { summary: `Selected a value in ${action.ref}` };
    }
    if (action.command === "upload") {
      if(!workspaceRoot)throw new Error('browser_upload_requires_user');const root=realpathSync(workspaceRoot),files=action.files.map((file)=>{const resolved=realpathSync(path.resolve(root,file)),relative=path.relative(root,resolved),details=statSync(resolved);if(relative.startsWith('..')||path.isAbsolute(relative)||!details.isFile()||details.size>25*1024*1024||!/[.](?:txt|md|pdf|docx|png|jpe?g)$/i.test(resolved))throw new Error('browser_upload_invalid');return resolved});
      if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
      const documentNode = await run(() => wc.debugger.sendCommand("DOM.getDocument")),
        found = await run(() => wc.debugger.sendCommand("DOM.querySelector", {
          nodeId: documentNode.root.nodeId,
          selector,
        }));
      if (!found.nodeId) throw new Error("browser_ref_missing");
      await run(() => wc.debugger.sendCommand("DOM.setFileInputFiles", {
        files,
        nodeId: found.nodeId,
      }));
      return {
        summary: `Attached ${files.length} user-authorized file${files.length === 1 ? "" : "s"}`,
      };
    }
    if (action.command === "screenshot") {
      const image = await run(() => wc.capturePage()),png=image.toPNG(),digest=createHash('sha256').update(png).digest('hex');
      return {
        summary: "Captured in-app browser screenshot",
        output: `Screenshot observed locally · ${image.getSize().width}×${image.getSize().height} · sha256 ${digest}. Raw pixels were not added to chat, sync, receipts, or model context.`,
      };
    }
    if (action.command === "wait") {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, action.milliseconds);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Canceled", "AbortError"));
        }, { once: true });
      });
      return { summary: `Waited ${action.milliseconds} ms` };
    }
    if (action.command === "close") {
      await this.close(workspaceId);
      return { summary: "Closed Waypoint In-App Browser" };
    }
    throw new Error("browser_action_invalid");
  }
  navigate(
    workspaceId: string,
    command: "back" | "forward" | "reload" | "stop",
  ) {
    const entry = this.entries.get(workspaceId);
    if (!entry) throw new Error("browser_surface_closed");
    const history = entry.view.webContents.navigationHistory;
    if (command === "back" && history.canGoBack()) history.goBack();
    else if (command === "forward" && history.canGoForward())
      history.goForward();
    else if (command === "reload") entry.view.webContents.reload();
    else if (command === "stop") entry.view.webContents.stop();
    return this.emit(entry);
  }
  async clear(workspaceId: string) {
    const entry = this.entries.get(workspaceId);
    if (entry) await entry.view.webContents.session.clearStorageData();
    return { cleared: true };
  }
  hide(workspaceId: string) {
    const entry = this.entries.get(workspaceId);
    if (entry?.attached) {
      entry.host.contentView.removeChildView(entry.view);
      entry.attached = false;
    }
    return { hidden: true as const };
  }
  async close(workspaceId: string) {
    const entry = this.entries.get(workspaceId);
    if (!entry) return { closed: true };
    this.entries.delete(workspaceId);
    if (entry.attached) entry.host.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    await entry.gate.close();
    this.notify(workspaceId, { ...entry.state, open: false, loading: false });
    return { closed: true };
  }
}
