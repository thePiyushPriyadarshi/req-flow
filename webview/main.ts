import type {
  ApiRequest,
  ApiResponse,
  HostToWebviewMessage,
  HttpMethod,
  KeyValue,
  WebviewToHostMessage,
} from "../src/types";
import {
  createJsonEditor,
  createReadonlyEditor,
  createTextEditor,
  destroyEditor,
  formatJson,
  minifyJson,
  setEditorDoc,
} from "./editor";
import type { EditorView } from "@codemirror/view";

declare const acquireVsCodeApi: () => {
  postMessage: (msg: WebviewToHostMessage) => void;
  setState: (s: unknown) => void;
  getState: () => unknown;
};

const vscode = acquireVsCodeApi();
const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

type BuilderTab = "params" | "headers" | "body" | "auth";
type ResponseView = "body" | "headers";

interface AppState {
  request: ApiRequest;
  activeEnv: string;
  variableKeys: string[];
  builderTab: BuilderTab;
  responseView: ResponseView;
  sending: boolean;
  response: ApiResponse | null;
  error: string | null;
  errorCode?: string;
  responseRaw: boolean;
  splitPercent: number;
  dirty: boolean;
}

const state: AppState = {
  request: defaultRequest(),
  activeEnv: "local",
  variableKeys: [],
  builderTab: "params",
  responseView: "body",
  sending: false,
  response: null,
  error: null,
  responseRaw: false,
  splitPercent: 45,
  dirty: false,
};

let bodyEditor: EditorView | undefined;
let responseEditor: EditorView | undefined;
let shellReady = false;
const app = document.getElementById("app")!;

function defaultRequest(): ApiRequest {
  return {
    id: "",
    name: "Untitled",
    method: "GET",
    url: "{{baseUrl}}/get",
    params: [],
    headers: [],
    body: { type: "none", content: "", form: [] },
    auth: { type: "none" },
  };
}

function hydrateRequest(req: ApiRequest): ApiRequest {
  return {
    ...req,
    params: req.params ?? [],
    headers: req.headers ?? [],
    body: {
      type: req.body?.type ?? "none",
      content: req.body?.content ?? "",
      form: req.body?.form ?? [],
    },
    auth: req.auth ?? { type: "none" },
  };
}

function syncEditorsToRequest(): void {
  if (bodyEditor) {
    state.request.body.content = bodyEditor.state.doc.toString();
  }
}

function post(msg: WebviewToHostMessage): void {
  vscode.postMessage(msg);
}

function emptyRow(): KeyValue {
  return { key: "", value: "", enabled: true };
}

function ensureRows(rows: KeyValue[]): KeyValue[] {
  return rows.length ? rows : [emptyRow()];
}

function mountShell(): void {
  app.innerHTML = `
    <div class="app-top-bar">
      <span class="unsaved-dot hidden" id="unsaved-dot" title="Unsaved changes" aria-hidden="true"></span>
      <button type="button" class="btn btn-ghost btn-sm" id="save">Save</button>
    </div>
    <div class="request-bar-sticky">
      <div class="request-bar">
        <select id="method" class="rf-input rf-input-method method-select" aria-label="HTTP method"></select>
        <input id="url" class="rf-input rf-input-url url-input" type="text" spellcheck="false" placeholder="{{baseUrl}}/path" aria-label="Request URL" />
        <div class="request-bar-actions">
          <button type="button" class="btn btn-danger btn-sm hidden" id="cancel" aria-label="Cancel request">Stop</button>
          <button type="button" class="btn btn-primary" id="send" aria-label="Send request">Send</button>
        </div>
      </div>
      <div class="url-warning hidden" id="url-warning" role="status"></div>
      <div class="progress-bar hidden" id="progress-bar" aria-hidden="true"></div>
    </div>
    <div class="workspace-split" id="workspace">
      <div class="request-pane" id="request-pane">
        <nav class="tab-bar-nav" aria-label="Request sections">
          <ul class="tab-bar section-tabs" role="tablist" id="builder-tabs"></ul>
        </nav>
        <div class="builder-panel surface" id="builder-panel"></div>
      </div>
      <div class="split-handle" id="split-handle" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Resize request and response"></div>
      <div class="response-pane" id="response-pane">
        <section class="response-block surface" id="response-section" aria-label="Response"></section>
      </div>
    </div>
  `;
  applySplit(state.splitPercent);
  bindShellEvents();
  bindSplitHandle();
  shellReady = true;
}

function applySplit(percent: number): void {
  const req = document.getElementById("request-pane") as HTMLElement;
  const res = document.getElementById("response-pane") as HTMLElement;
  if (!req || !res) {
    return;
  }
  req.style.flexBasis = `${percent}%`;
  res.style.flexBasis = `${100 - percent}%`;
}

function bindSplitHandle(): void {
  const handle = document.getElementById("split-handle")!;
  const workspace = document.getElementById("workspace")!;
  let dragging = false;
  const onMove = (clientY: number): void => {
    const rect = workspace.getBoundingClientRect();
    const pct = Math.min(70, Math.max(25, ((clientY - rect.top) / rect.height) * 100));
    state.splitPercent = Math.round(pct);
    applySplit(state.splitPercent);
    vscode.setState({ splitPercent: state.splitPercent });
    post({ type: "persistSplit", splitPercent: state.splitPercent });
  };
  handle.addEventListener("mousedown", () => {
    dragging = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (dragging) {
      onMove(e.clientY);
    }
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  handle.addEventListener("dblclick", () => {
    state.splitPercent = 45;
    applySplit(45);
    post({ type: "persistSplit", splitPercent: 45 });
  });
}

function syncParamsFromUrl(url: string): void {
  try {
    const sanitized = url.replace(/\{\{[^}]+\}\}/g, "placeholder");
    const u = new URL(sanitized);
    const params: KeyValue[] = [];
    u.searchParams.forEach((value, key) => {
      params.push({ key, value, enabled: true });
    });
    if (params.length) {
      state.request.params = [...params, emptyRow()];
    }
  } catch {
    /* invalid url */
  }
}

function bindShellEvents(): void {
  document.getElementById("send")!.addEventListener("click", () => void doSend());
  document.getElementById("cancel")!.addEventListener("click", () => {
    post({ type: "cancel" });
    state.sending = false;
    renderChrome();
  });
  document.getElementById("save")!.addEventListener("click", () => doSave());
  document.getElementById("method")!.addEventListener("change", (e) => {
    state.request.method = (e.target as HTMLSelectElement).value as HttpMethod;
    syncMethodSelect();
    debouncedDraft();
  });
  document.getElementById("url")!.addEventListener("input", (e) => {
    state.request.url = (e.target as HTMLInputElement).value;
    syncParamsFromUrl(state.request.url);
    highlightUrlVars();
    debouncedDraft();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void doSend();
    }
    if (e.key === "Escape" && state.sending) {
      post({ type: "cancel" });
      state.sending = false;
      renderAll();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
      if (state.builderTab === "body" && state.request.body.type === "json" && bodyEditor) {
        e.preventDefault();
        formatJson(bodyEditor);
      }
    }
  });
}

let draftTimer: ReturnType<typeof setTimeout> | undefined;
function debouncedDraft(): void {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    state.dirty = true;
    post({ type: "saveDraft", request: state.request });
    renderChrome();
  }, 500);
}

function syncMethodSelect(): void {
  const sel = document.getElementById("method") as HTMLSelectElement;
  sel.className = `rf-input rf-input-method method-select method-${state.request.method}`;
  sel.innerHTML = METHODS.map(
    (m) => `<option value="${m}" ${m === state.request.method ? "selected" : ""}>${m}</option>`
  ).join("");
}

function syncTopBar(): void {
  (document.getElementById("url") as HTMLInputElement).value = state.request.url;
  syncMethodSelect();
  highlightUrlVars();
  renderChrome();
}

function renderChrome(): void {
  const sendBtn = document.getElementById("send");
  const cancelBtn = document.getElementById("cancel");
  const saveBtn = document.getElementById("save");
  const progress = document.getElementById("progress-bar");
  const dot = document.getElementById("unsaved-dot");
  if (!sendBtn) {
    return;
  }
  sendBtn.classList.toggle("hidden", state.sending);
  cancelBtn?.classList.toggle("hidden", !state.sending);
  saveBtn?.toggleAttribute("disabled", state.sending);
  sendBtn.toggleAttribute("disabled", state.sending);
  progress?.classList.toggle("hidden", !state.sending);
  dot?.classList.toggle("hidden", !state.dirty);
  const unresolved = findUnresolved(state.request.url);
  const warn = document.getElementById("url-warning");
  if (warn) {
    if (unresolved.length) {
      warn.textContent = `Variable(s) not in ${state.activeEnv}: ${unresolved.map((v) => `{{${v}}}`).join(", ")}`;
      warn.classList.remove("hidden");
    } else {
      warn.classList.add("hidden");
    }
  }
}

function countEnabled(rows: KeyValue[]): number {
  return rows.filter((r) => r.enabled && r.key.trim()).length;
}

function tabLabel(tab: BuilderTab): string {
  const base = cap(tab);
  if (tab === "params") {
    const n = countEnabled(state.request.params);
    return n ? `${base} (${n})` : base;
  }
  if (tab === "headers") {
    const n = countEnabled(state.request.headers);
    return n ? `${base} (${n})` : base;
  }
  if (tab === "body") {
    return state.request.body.type !== "none" ? `${base} •` : base;
  }
  if (tab === "auth") {
    return state.request.auth.type !== "none" ? `${base} •` : base;
  }
  return base;
}

function highlightUrlVars(): void {
  const input = document.getElementById("url") as HTMLInputElement;
  const unresolved = findUnresolved(input.value);
  input.classList.toggle("has-unresolved", unresolved.length > 0);
}

function findUnresolved(text: string): string[] {
  const keys = new Set(state.variableKeys);
  const out: string[] = [];
  const re = /\{\{(\s*[\w.-]+\s*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const k = m[1]!.trim();
    if (!keys.has(k)) {
      out.push(k);
    }
  }
  return out;
}

function renderBuilderTabs(): void {
  const tabs = document.getElementById("builder-tabs")!;
  const names: BuilderTab[] = ["params", "headers", "body", "auth"];
  tabs.innerHTML = names
    .map(
      (t) =>
        `<li><button type="button" class="tab-bar-btn" data-tab="${t}" aria-selected="${state.builderTab === t}">${tabLabel(t)}</button></li>`
    )
    .join("");
  tabs.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.builderTab = (btn as HTMLElement).dataset.tab as BuilderTab;
      renderBuilderPanel();
      renderBuilderTabs();
    });
  });
}

function renderBuilderPanel(): void {
  const panel = document.getElementById("builder-panel")!;
  destroyEditor(bodyEditor);
  bodyEditor = undefined;

  switch (state.builderTab) {
    case "params":
      panel.innerHTML = kvTableHtml("params", state.request.params, "Query parameters");
      bindKvTable(panel, "params");
      break;
    case "headers":
      panel.innerHTML = autoHeadersHtml() + kvTableHtml("headers", state.request.headers, "Headers");
      bindKvTable(panel, "headers");
      panel.querySelector(".kv-table-footer")?.insertAdjacentHTML(
        "beforeend",
        `<button type="button" class="btn btn-ghost btn-sm" id="bulk-headers">Paste headers</button>`
      );
      document.getElementById("bulk-headers")?.addEventListener("click", pasteBulkHeaders);
      break;
    case "body":
      panel.innerHTML = bodyPanelHtml();
      bindBodyPanel(panel);
      break;
    case "auth":
      panel.innerHTML = authPanelHtml();
      bindAuthPanel();
      break;
  }
}

function autoHeadersHtml(): string {
  const rows: { key: string; value: string }[] = [];
  if (state.request.body.type === "json") {
    rows.push({ key: "Content-Type", value: "application/json (auto)" });
  } else if (state.request.body.type === "text") {
    rows.push({ key: "Content-Type", value: "text/plain (auto)" });
  } else if (state.request.body.type === "form") {
    rows.push({ key: "Content-Type", value: "application/x-www-form-urlencoded (auto)" });
  }
  if (state.request.auth.type === "bearer" && state.request.auth.token) {
    rows.push({ key: "Authorization", value: "Bearer … (auto)" });
  }
  if (state.request.auth.type === "basic" && state.request.auth.username) {
    rows.push({ key: "Authorization", value: "Basic … (auto)" });
  }
  if (!rows.length) {
    return "";
  }
  return `<div class="auto-headers"><span class="auto-label">Auto</span>${rows
    .map((r) => `<div class="auto-row"><span>${esc(r.key)}</span><span>${esc(r.value)}</span></div>`)
    .join("")}</div>`;
}

function kvTableHtml(id: string, rows: KeyValue[], caption: string): string {
  const data = ensureRows(rows);
  return `
    <div class="kv-table-wrap">
      <table class="kv-table" data-kv="${id}" aria-label="${caption}">
        <thead><tr><th scope="col" class="col-check"></th><th scope="col">Key</th><th scope="col">Value</th><th scope="col" class="col-action"></th></tr></thead>
        <tbody>
          ${data
            .map(
              (row, i) => `
            <tr data-idx="${i}">
              <td class="col-check"><input type="checkbox" class="kv-check" ${row.enabled ? "checked" : ""} aria-label="Enable row" /></td>
              <td><input type="text" class="rf-input rf-input-sm kv-key" value="${escAttr(row.key)}" placeholder="Key" list="header-keys" /></td>
              <td><input type="text" class="rf-input rf-input-sm kv-val" value="${escAttr(row.value)}" placeholder="Value" /></td>
              <td class="col-action"><button type="button" class="btn btn-icon-only btn-ghost btn-remove" aria-label="Remove row">×</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <datalist id="header-keys">
        <option value="Content-Type"></option>
        <option value="Accept"></option>
        <option value="Authorization"></option>
        <option value="User-Agent"></option>
      </datalist>
      <div class="kv-table-footer">
        <button type="button" class="btn btn-ghost btn-sm add-row" data-add="${id}">Add row</button>
      </div>
    </div>
  `;
}

function bindKvTable(panel: HTMLElement, field: "params" | "headers"): void {
  const table = panel.querySelector(`[data-kv="${field}"]`) as HTMLTableElement;
  const read = (): KeyValue[] => {
    const rows: KeyValue[] = [];
    table.querySelectorAll("tbody tr").forEach((tr) => {
      rows.push({
        enabled: (tr.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
        key: (tr.querySelector(".kv-key") as HTMLInputElement).value,
        value: (tr.querySelector(".kv-val") as HTMLInputElement).value,
      });
    });
    return rows;
  };
  const sync = (): void => {
    state.request[field] = read();
    debouncedDraft();
    if (field === "headers" && state.builderTab === "headers") {
      renderBuilderPanel();
    }
  };
  table.addEventListener("input", sync);
  table.addEventListener("change", sync);
  panel.querySelector(`[data-add="${field}"]`)?.addEventListener("click", () => {
    state.request[field] = [...read(), emptyRow()];
    renderBuilderPanel();
  });
  table.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number((btn.closest("tr") as HTMLElement).dataset.idx);
      const rows = read().filter((_, i) => i !== idx);
      state.request[field] = rows.length ? rows : [emptyRow()];
      renderBuilderPanel();
    });
  });
}

function bodyPanelHtml(): string {
  const t = state.request.body.type;
  const types: ApiRequest["body"]["type"][] = ["none", "json", "form", "text"];
  const labels: Record<ApiRequest["body"]["type"], string> = {
    none: "None",
    json: "JSON",
    form: "Form",
    text: "Text",
  };
  return `
    <div class="panel-toolbar body-type-row">
      <div class="segmented segmented--options" role="radiogroup" aria-label="Body type">
        ${types
          .map(
            (type) =>
              `<button type="button" class="segmented-btn segmented-btn--${type}" data-body-type="${type}" role="radio" aria-checked="${t === type}">${labels[type]}</button>`
          )
          .join("")}
      </div>
      ${
        t === "json"
          ? `<div class="body-toolbar-actions">
               <button type="button" class="btn btn-ghost btn-sm" id="fmt-json">Prettify</button>
               <button type="button" class="btn btn-ghost btn-sm" id="min-json">Minify</button>
             </div>`
          : ""
      }
    </div>
    <div id="body-none-hint" class="builder-subpanel builder-subpanel--empty ${t === "none" ? "" : "hidden"}">No request body</div>
    <div id="body-editor-host" class="editor-host editor-host--body ${t === "json" ? "editor-host--json" : t === "text" ? "editor-host--text" : ""} ${t === "none" || t === "form" ? "hidden" : ""}"></div>
    <div id="body-form-host" class="builder-subpanel ${t === "form" ? "" : "hidden"}"></div>
  `;
}

function bindBodyPanel(panel: HTMLElement): void {
  panel.querySelectorAll("[data-body-type]").forEach((el) => {
    el.addEventListener("click", () => {
      const next = (el as HTMLElement).dataset.bodyType as ApiRequest["body"]["type"];
      if (state.request.body.type === next) {
        return;
      }
      state.request.body.type = next;
      if (state.request.body.type === "form" && !state.request.body.form.length) {
        state.request.body.form = [emptyRow()];
      }
      renderBuilderPanel();
      debouncedDraft();
    });
  });

  if (state.request.body.type === "form") {
    const host = panel.querySelector("#body-form-host")!;
    host.innerHTML = kvTableHtml("form", state.request.body.form, "Form fields");
    bindFormTable(host);
    return;
  }

  if (state.request.body.type === "json" || state.request.body.type === "text") {
    const host = panel.querySelector("#body-editor-host") as HTMLElement;
    host.classList.remove("hidden");
    const onChange = (v: string): void => {
      state.request.body.content = v;
      debouncedDraft();
    };
    if (state.request.body.type === "json") {
      bodyEditor = createJsonEditor(
        host,
        state.request.body.content || '{\n  \n}',
        state.variableKeys,
        onChange
      );
      document.getElementById("fmt-json")?.addEventListener("click", () => bodyEditor && formatJson(bodyEditor));
      document.getElementById("min-json")?.addEventListener("click", () => bodyEditor && minifyJson(bodyEditor));
    } else {
      bodyEditor = createTextEditor(
        host,
        state.request.body.content,
        state.variableKeys,
        onChange
      );
    }
  }
}

function bindFormTable(host: HTMLElement): void {
  const table = host.querySelector('[data-kv="form"]') as HTMLTableElement;
  const read = (): KeyValue[] => {
    const rows: KeyValue[] = [];
    table.querySelectorAll("tbody tr").forEach((tr) => {
      rows.push({
        enabled: (tr.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
        key: (tr.querySelector(".kv-key") as HTMLInputElement).value,
        value: (tr.querySelector(".kv-val") as HTMLInputElement).value,
      });
    });
    return rows;
  };
  const sync = (): void => {
    state.request.body.form = read();
    debouncedDraft();
  };
  table.addEventListener("input", sync);
  table.addEventListener("change", sync);
  host.querySelector('[data-add="form"]')?.addEventListener("click", () => {
    state.request.body.form = [...read(), emptyRow()];
    renderBuilderPanel();
  });
  table.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number((btn.closest("tr") as HTMLElement).dataset.idx);
      const rows = read().filter((_, i) => i !== idx);
      state.request.body.form = rows.length ? rows : [emptyRow()];
      renderBuilderPanel();
    });
  });
}

function authPanelHtml(): string {
  const a = state.request.auth;
  const authTypes: ApiRequest["auth"]["type"][] = ["none", "bearer", "basic"];
  const authLabels: Record<ApiRequest["auth"]["type"], string> = {
    none: "None",
    bearer: "Bearer",
    basic: "Basic",
  };
  const hasFields = a.type === "bearer" || a.type === "basic";
  return `
    <div class="panel-toolbar body-type-row">
      <div class="segmented segmented--options" role="radiogroup" aria-label="Auth type">
        ${authTypes
          .map(
            (type) =>
              `<button type="button" class="segmented-btn segmented-btn--auth-${type}" data-auth-type="${type}" role="radio" aria-checked="${a.type === type}">${authLabels[type]}</button>`
          )
          .join("")}
      </div>
    </div>
    <div class="builder-subpanel builder-subpanel--empty ${a.type === "none" ? "" : "hidden"}">No authorization</div>
    <div class="builder-subpanel ${hasFields ? "" : "hidden"}">
      <div class="auth-fields ${a.type === "bearer" ? "" : "hidden"}" id="auth-bearer">
        <div class="auth-field">
          <label class="text-label" for="auth-token">Token</label>
          <input type="password" class="rf-input rf-input-sm rf-input-mono" id="auth-token" value="${escAttr(a.token ?? "")}" placeholder="{{token}}" autocomplete="off" />
          <p class="auth-field-hint">Sent as <code class="auth-code">Authorization: Bearer …</code></p>
        </div>
      </div>
      <div class="auth-fields ${a.type === "basic" ? "" : "hidden"}" id="auth-basic">
        <div class="auth-field">
          <label class="text-label" for="auth-user">Username</label>
          <input type="text" class="rf-input rf-input-sm" id="auth-user" value="${escAttr(a.username ?? "")}" autocomplete="off" />
        </div>
        <div class="auth-field">
          <label class="text-label" for="auth-pass">Password</label>
          <input type="password" class="rf-input rf-input-sm" id="auth-pass" value="${escAttr(a.password ?? "")}" autocomplete="off" />
          <p class="auth-field-hint">Sent as <code class="auth-code">Authorization: Basic …</code></p>
        </div>
      </div>
    </div>
  `;
}

function bindAuthPanel(): void {
  document.querySelectorAll("[data-auth-type]").forEach((el) => {
    el.addEventListener("click", () => {
      const next = (el as HTMLElement).dataset.authType as ApiRequest["auth"]["type"];
      if (state.request.auth.type === next) {
        return;
      }
      state.request.auth.type = next;
      renderBuilderPanel();
      debouncedDraft();
    });
  });
  document.getElementById("auth-token")?.addEventListener("input", (e) => {
    state.request.auth.token = (e.target as HTMLInputElement).value;
    debouncedDraft();
  });
  document.getElementById("auth-user")?.addEventListener("input", (e) => {
    state.request.auth.username = (e.target as HTMLInputElement).value;
    debouncedDraft();
  });
  document.getElementById("auth-pass")?.addEventListener("input", (e) => {
    state.request.auth.password = (e.target as HTMLInputElement).value;
    debouncedDraft();
  });
}

function pasteBulkHeaders(): void {
  void navigator.clipboard.readText().then((text) => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const parsed: KeyValue[] = [];
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) {
        continue;
      }
      parsed.push({
        key: line.slice(0, idx).trim(),
        value: line.slice(idx + 1).trim(),
        enabled: true,
      });
    }
    if (parsed.length) {
      state.request.headers = [...state.request.headers.filter((h) => h.key), ...parsed];
      renderBuilderPanel();
      debouncedDraft();
    }
  });
}

function renderResponse(): void {
  const section = document.getElementById("response-section")!;
  destroyEditor(responseEditor);
  responseEditor = undefined;

  if (state.sending) {
    section.innerHTML = `
      <div class="loading-state" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <span>Sending request…</span>
      </div>`;
    return;
  }

  if (state.error) {
    const isCancel = state.errorCode === "cancelled";
    const isTimeout = state.errorCode === "timeout";
    section.innerHTML = `
      <div class="error-card ${isCancel ? "is-neutral" : ""}">
        <strong>${isCancel ? "Request cancelled" : isTimeout ? "Timed out" : "Request failed"}</strong>
        <p>${esc(state.error)}</p>
        ${!isCancel ? `<button type="button" class="btn btn-secondary" id="retry">Retry</button>` : ""}
      </div>`;
    document.getElementById("retry")?.addEventListener("click", () => void doSend());
    return;
  }
  if (!state.response) {
    section.innerHTML = `<div class="empty-response">Press Send or Ctrl+Enter to get a response</div>`;
    return;
  }

  const r = state.response;
  const ct = r.headers["content-type"] ?? r.headers["Content-Type"] ?? "";
  const isJson = ct.includes("json") && !state.responseRaw;
  let bodyText = r.body;
  if (isJson) {
    try {
      bodyText = JSON.stringify(JSON.parse(r.body), null, 2);
    } catch {
      /* raw */
    }
  }

  section.innerHTML = `
    <div class="response-sticky-chrome">
      <div class="response-header-bar">
        <div class="response-meta">
          <span class="status-chip ${statusClass(r.status)}" role="status">${r.status} ${esc(r.statusText)}</span>
          <span class="meta-item">${r.timeMs} ms</span>
          <span class="meta-item">${formatBytes(r.sizeBytes)}</span>
        </div>
        <div class="response-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="copy-resp">Copy</button>
        </div>
      </div>
      <nav class="tab-bar-nav response-tab-nav" aria-label="Response view">
        <div class="tab-bar response-tabs" role="tablist">
          <button type="button" class="tab-bar-btn" role="tab" data-rview="body" aria-selected="${state.responseView === "body"}">Body</button>
          <button type="button" class="tab-bar-btn" role="tab" data-rview="headers" aria-selected="${state.responseView === "headers"}">Headers (${Object.keys(r.headers).length})</button>
          ${
            state.responseView === "body" && ct.includes("json")
              ? `<button type="button" class="btn btn-ghost btn-sm raw-toggle" id="raw-toggle">${state.responseRaw ? "Pretty JSON" : "Raw"}</button>`
              : ""
          }
        </div>
      </nav>
    </div>
    <div class="response-viewport">
      <div id="response-body-host" class="editor-host response-editor-host ${state.responseView === "headers" ? "hidden" : ""}"></div>
      <div class="response-headers-panel ${state.responseView === "headers" ? "" : "hidden"}"></div>
    </div>
  `;

  document.getElementById("copy-resp")?.addEventListener("click", () => {
    post({ type: "copyResponse", text: r.body });
  });

  section.querySelectorAll("[data-rview]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.responseView = (btn as HTMLElement).dataset.rview as ResponseView;
      renderResponse();
    });
  });

  document.getElementById("raw-toggle")?.addEventListener("click", () => {
    state.responseRaw = !state.responseRaw;
    renderResponse();
  });

  if (state.responseView === "headers") {
    const host = section.querySelector(".response-headers-panel")!;
    host.innerHTML = responseHeadersTableHtml(r.headers);
  } else {
    const host = section.querySelector("#response-body-host") as HTMLElement;
    responseEditor = createReadonlyEditor(host, bodyText, isJson);
  }
}

function renderAll(): void {
  if (!shellReady) {
    mountShell();
  }
  syncTopBar();
  renderBuilderTabs();
  renderBuilderPanel();
  renderResponse();
  renderChrome();
}

function doSave(): void {
  syncEditorsToRequest();
  post({ type: "saveRequest", request: state.request });
}

async function doSend(): Promise<void> {
  if (state.sending) {
    return;
  }
  syncEditorsToRequest();
  state.sending = true;
  state.error = null;
  renderAll();
  post({ type: "send", request: state.request });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) {
    return "is-2xx";
  }
  if (status >= 400 && status < 500) {
    return "is-4xx";
  }
  if (status >= 500) {
    return "is-5xx";
  }
  return "";
}

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function responseHeadersTableHtml(headers: Record<string, string>): string {
  const entries = Object.entries(headers).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { sensitivity: "base" })
  );
  if (!entries.length) {
    return `<p class="response-headers-empty">No response headers</p>`;
  }
  return `
    <div class="response-headers-wrap">
      <table class="response-headers-table" aria-label="Response headers">
        <thead>
          <tr>
            <th scope="col">Header</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          ${entries
            .map(
              ([name, value]) =>
                `<tr><td class="rh-name">${esc(name)}</td><td class="rh-value">${esc(value)}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage | { type: string }>) => {
  const msg = event.data;
  if (msg.type === "init") {
    const m = msg as HostToWebviewMessage & { type: "init" };
    const saved = vscode.getState() as { splitPercent?: number } | undefined;
    state.request = hydrateRequest(m.request);
    state.activeEnv = m.activeEnvironment;
    state.variableKeys = m.variableKeys;
    state.splitPercent = saved?.splitPercent ?? m.splitPercent ?? 45;
    state.dirty = false;
    state.sending = false;
    state.response = m.restoredResponse ?? null;
    if (m.restoredError) {
      state.error = m.restoredError.message;
      state.errorCode = m.restoredError.code;
    } else {
      state.error = null;
      state.errorCode = undefined;
    }
    state.responseRaw = false;
    state.responseView = "body";
    renderAll();
    applySplit(state.splitPercent);
    return;
  }
  if (msg.type === "envChanged") {
    const m = msg as HostToWebviewMessage & { type: "envChanged" };
    state.activeEnv = m.activeEnvironment;
    state.variableKeys = m.variableKeys;
    syncTopBar();
    if (bodyEditor) {
      setEditorDoc(bodyEditor, bodyEditor.state.doc.toString());
    }
    return;
  }
  if (msg.type === "triggerSend") {
    void doSend();
    return;
  }
  if (msg.type === "triggerSave") {
    doSave();
    return;
  }
  if (msg.type === "idle") {
    state.sending = false;
    renderAll();
    return;
  }
  if (msg.type === "sending") {
    state.sending = true;
    renderAll();
    return;
  }
  if (msg.type === "response") {
    state.sending = false;
    state.response = (msg as HostToWebviewMessage & { type: "response" }).data;
    state.error = null;
    state.errorCode = undefined;
    state.responseRaw = false;
    state.responseView = "body";
    renderAll();
    return;
  }
  if (msg.type === "focusUrl") {
    document.getElementById("url")?.focus();
    return;
  }
  if (msg.type === "error") {
    state.sending = false;
    const err = (msg as HostToWebviewMessage & { type: "error" }).error;
    state.error = err.message;
    state.errorCode = err.code;
    renderAll();
  }
  if (msg.type === "saved") {
    state.request = hydrateRequest((msg as HostToWebviewMessage & { type: "saved" }).request);
    state.dirty = false;
    syncTopBar();
  }
});

post({ type: "ready" });
mountShell();
renderAll();
