import * as vscode from "vscode";
import { sendRequest } from "../http/client";
import { toCurl } from "../http/curl";
import type { ReqFlowStore } from "../storage/store";
import type {
  ApiError,
  ApiRequest,
  ApiResponse,
  HistoryEntry,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "../types";
import { buildOutboundFromDraft } from "../variables";

const PANEL_VIEW_TYPE = "reqflow.request";

export interface RequestPanelDeps {
  store: ReqFlowStore;
  onSaved: () => void;
  onHistory: () => void;
  onEnvChange: () => void;
  onSendingChange?: (sending: boolean) => void;
}

export class RequestPanel {
  private static focused: RequestPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly deps: RequestPanelDeps;
  private request: ApiRequest;
  private abortController: AbortController | undefined;
  private isPreview: boolean;
  private dirty = false;
  private disposeCb: (() => void) | undefined;
  private pinCb: (() => void) | undefined;
  private panelStorageKey: string | undefined;
  private restoredResponse: ApiResponse | undefined;
  private restoredError: ApiError | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    request: ApiRequest,
    deps: RequestPanelDeps,
    preview: boolean
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.deps = deps;
    this.request = structuredClone(request);
    this.isPreview = preview;
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "icon.svg");

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) =>
      this.handleMessage(msg)
    );
    this.panel.onDidDispose(() => {
      this.abortController?.abort();
      this.deps.onSendingChange?.(false);
      this.disposeCb?.();
      if (RequestPanel.focused === this) {
        RequestPanel.focused = undefined;
      }
    });
    this.panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        RequestPanel.focused = this;
      }
    });
    RequestPanel.focused = this;
    this.updateTitle();
  }

  public static create(
    extensionUri: vscode.Uri,
    deps: RequestPanelDeps,
    request: ApiRequest,
    options: { preview?: boolean }
  ): RequestPanel {
    const column = vscode.window.activeTextEditor?.viewColumn;
    const panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      request.name,
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );
    return new RequestPanel(
      panel,
      extensionUri,
      request,
      deps,
      options.preview ?? false
    );
  }

  public static getFocused(): RequestPanel | undefined {
    return RequestPanel.focused;
  }

  onDidDispose(cb: () => void): void {
    this.disposeCb = cb;
  }

  onDidPin(cb: () => void): void {
    this.pinCb = cb;
  }

  reveal(): void {
    this.panel.reveal();
  }

  public refreshTheme(): void {
    this.pushInit();
  }

  public notifyEnvChange(): void {
    this.post({
      type: "envChanged",
      activeEnvironment: this.deps.store.getActiveEnvironmentName(),
      variableKeys: this.deps.store.getVariableKeys(),
    });
  }

  public loadRequest(request: ApiRequest, options?: { preview?: boolean }): void {
    this.request = structuredClone(request);
    this.restoredResponse = undefined;
    this.restoredError = undefined;
    if (options?.preview !== undefined) {
      this.isPreview = options.preview;
    }
    this.dirty = false;
    this.updateTitle();
    this.pushInit();
  }

  public loadHistoryEntry(entry: HistoryEntry): void {
    this.request = structuredClone(entry.request);
    this.request.id = `history-${entry.id}`;
    this.restoredResponse = entry.response;
    this.restoredError = entry.error;
    this.isPreview = false;
    this.dirty = false;
    this.updateTitle();
    this.pushInit();
  }

  public setPanelStorageKey(key: string): void {
    this.panelStorageKey = key;
  }

  public getPanelStorageKey(): string | undefined {
    return this.panelStorageKey;
  }

  public pin(): void {
    if (!this.isPreview) {
      return;
    }
    this.isPreview = false;
    this.pinCb?.();
    this.updateTitle();
  }

  public sendFromCommand(): void {
    void this.panel.webview.postMessage({ type: "triggerSend" });
  }

  public triggerSave(): void {
    void this.panel.webview.postMessage({ type: "triggerSave" });
  }

  public focusUrl(): void {
    void this.panel.webview.postMessage({ type: "focusUrl" });
  }

  public syncRequestName(name: string): void {
    this.request.name = name;
    this.updateTitle();
  }

  public async promptRename(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: "Request name (editor tab and Collections tree)",
      value: this.request.name,
    });
    if (!name || name === this.request.name) {
      return;
    }
    this.request.name = name;
    this.updateTitle();
    if (this.deps.store.findRequest(this.request.id)) {
      await this.deps.store.saveRequest(this.request);
      this.dirty = false;
      this.deps.onSaved();
      this.post({ type: "saved", request: this.request });
    } else {
      this.dirty = true;
      this.updateTitle();
    }
  }

  public cancelRequest(): void {
    this.abortController?.abort();
  }

  public copyCurl(): void {
    const env = this.deps.store.getActiveEnvironment();
    const built = buildOutboundFromDraft(
      this.request,
      env.variables,
      env.defaultHeaders ?? []
    );
    const curl = toCurl({
      method: built.method,
      url: built.url,
      headers: built.headers,
      body: built.body,
    });
    void vscode.env.clipboard.writeText(curl);
    void vscode.window.setStatusBarMessage("ReqFlow: Copied cURL command", 3000);
  }

  private updateTitle(): void {
    const prefix = this.isPreview ? "[Preview] " : "";
    const dot = this.dirty ? " •" : "";
    this.panel.title = `${prefix}${this.request.name}${dot}`;
  }

  private pushInit(): void {
    const env = this.deps.store.getActiveEnvironment();
    const splitPercent =
      this.deps.store.getUiPreference().splitPercent ?? 45;
    this.post({
      type: "init",
      request: this.request,
      theme: getThemeKind(),
      environments: this.deps.store.getEnvironments(),
      activeEnvironment: env.name,
      variableKeys: this.deps.store.getVariableKeys(),
      splitPercent,
      isPreview: this.isPreview,
      restoredResponse: this.restoredResponse ?? null,
      restoredError: this.restoredError ?? null,
    });
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "styles.css")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>ReqFlow</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private handleMessage(msg: WebviewToHostMessage): void {
    switch (msg.type) {
      case "ready":
        this.pushInit();
        break;
      case "newRequest":
        void vscode.commands.executeCommand("reqflow.newRequest");
        break;
      case "saveDraft":
        this.mergeDraft(msg.request);
        this.dirty = true;
        this.updateTitle();
        // Auto-persist the draft so it survives extension restarts
        this.post({ type: "autoSaving" });
        void this.deps.store.saveDraft(this.request.id, this.request).then(() => {
          this.post({ type: "autoSaved" });
        });
        break;
      case "saveRequest":
        void this.persistRequest(msg.request);
        break;
      case "send":
        void this.executeSend(msg.request);
        break;
      case "cancel":
        this.cancelRequest();
        break;
      case "persistSplit":
        void this.deps.store.setUiPreference({ splitPercent: msg.splitPercent });
        break;
      case "copyResponse":
        void vscode.env.clipboard.writeText(msg.text);
        void vscode.window.setStatusBarMessage("ReqFlow: Response copied", 3000);
        break;
      default:
        break;
    }
  }

  private mergeDraft(partial: Partial<ApiRequest>): void {
    this.request = {
      ...this.request,
      ...partial,
      params: partial.params ?? this.request.params,
      headers: partial.headers ?? this.request.headers,
      body: partial.body ? { ...this.request.body, ...partial.body } : this.request.body,
      auth: partial.auth ? { ...this.request.auth, ...partial.auth } : this.request.auth,
    };
    if (partial.name) {
      this.updateTitle();
    }
  }

  private async persistRequest(draft: ApiRequest): Promise<void> {
    this.mergeDraft(draft);
    this.pin();

    if (!this.deps.store.findRequest(this.request.id)) {
      const collections = this.deps.store.getCollections();
      if (!collections.length) {
        await this.deps.store.addCollection("My API");
      }
      const roots = this.deps.store.getCollections();
      const pick = await vscode.window.showQuickPick(
        roots.map((c) => ({ label: c.name, id: c.id })),
        { placeHolder: "Save to collection" }
      );
      if (!pick) {
        return;
      }
      await this.deps.store.addRequest(pick.id, this.request);
    } else {
      await this.deps.store.saveRequest(this.request);
    }

    const saved =
      this.deps.store.findRequest(this.request.id)?.request ?? this.request;
    this.request = saved;
    this.dirty = false;
    this.updateTitle();
    this.deps.onSaved();
    this.post({ type: "saved", request: saved });
    // Draft is now persisted in collections — clear the standalone draft file
    void this.deps.store.clearDraft();
  }

  private async executeSend(draft: ApiRequest): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.deps.onSendingChange?.(true);
    this.post({ type: "sending" });
    this.mergeDraft(draft);
    this.pin();

    const env = this.deps.store.getActiveEnvironment();
    const built = buildOutboundFromDraft(
      this.request,
      env.variables,
      env.defaultHeaders ?? []
    );

    if (built.unresolved.length > 0) {
      const proceed = await vscode.window.showWarningMessage(
        `Variable(s) not defined in \`${env.name}\`: ${built.unresolved.join(", ")}`,
        "Send anyway",
        "Cancel"
      );
      if (proceed !== "Send anyway") {
        this.post({ type: "idle" });
        this.deps.onSendingChange?.(false);
        return;
      }
    }

    if (this.request.body.type === "json" && this.request.body.content.trim()) {
      try {
        JSON.parse(built.body ?? this.request.body.content);
      } catch {
        const ok = await vscode.window.showWarningMessage(
          "Request body is not valid JSON. Send anyway?",
          "Send anyway",
          "Cancel"
        );
        if (ok !== "Send anyway") {
          this.post({ type: "idle" });
          this.deps.onSendingChange?.(false);
          return;
        }
      }
    }

    try {
      const data: ApiResponse = await sendRequest(
        {
          method: built.method,
          url: built.url,
          headers: built.headers,
          body: built.body,
        },
        this.abortController.signal
      );
      this.post({ type: "response", data });
      await this.deps.store.pushHistory({
        request: this.request,
        response: data,
        status: data.status,
        timeMs: data.timeMs,
        environment: env.name,
      });
      this.deps.onHistory();
    } catch (err) {
      const error = err as ApiError;
      const message = error.message ?? "Request failed";
      const kind =
        message.includes("cancelled") || message.includes("Cancelled")
          ? "cancelled"
          : message.includes("timed out")
            ? "timeout"
            : "network";
      const apiError: ApiError = { message, code: kind };
      this.post({
        type: "error",
        error: apiError,
      });
      if (kind !== "cancelled") {
        await this.deps.store.pushHistory({
          request: this.request,
          error: apiError,
          environment: env.name,
        });
        this.deps.onHistory();
      }
    } finally {
      this.deps.onSendingChange?.(false);
    }
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function getThemeKind(): "light" | "dark" | "hc" {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
    case vscode.ColorThemeKind.HighContrastLight:
      return "light";
    case vscode.ColorThemeKind.HighContrast:
      return "hc";
    default:
      return "dark";
  }
}
