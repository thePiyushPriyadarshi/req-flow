import * as vscode from "vscode";
import type { Environment } from "../types";
import type { ReqFlowStore } from "../storage/store";

const VIEW = "reqflow.environment";

export class EnvironmentEditorPanel {
  private static openPanels = new Map<string, EnvironmentEditorPanel>();

  static show(
    extensionUri: vscode.Uri,
    store: ReqFlowStore,
    envName: string,
    onSaved: () => void
  ): void {
    const existing = this.openPanels.get(envName);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const env =
      store.getEnvironments().find((e) => e.name === envName) ??
      store.getActiveEnvironment();
    const panel = vscode.window.createWebviewPanel(
      VIEW,
      `Env: ${env.name}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    const editor = new EnvironmentEditorPanel(panel, extensionUri, store, env, onSaved);
    this.openPanels.set(envName, editor);
    panel.onDidDispose(() => this.openPanels.delete(envName));
  }

  private constructor(
    public readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    store: ReqFlowStore,
    private env: Environment,
    onSaved: () => void
  ) {
    panel.webview.html = this.getHtml(extensionUri);
    panel.webview.onDidReceiveMessage(async (msg: EnvWebviewMessage) => {
      if (msg.type === "ready") {
        this.postInit();
      } else if (msg.type === "save") {
        await store.upsertEnvironment(msg.environment);
        this.env = msg.environment;
        onSaved();
        void panel.webview.postMessage({ type: "saved" });
        void vscode.window.setStatusBarMessage(
          `ReqFlow: saved environment "${msg.environment.name}"`,
          3000
        );
      }
    });
  }

  private postInit(): void {
    void this.panel.webview.postMessage({ type: "init", environment: this.env });
  }

  private getHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "media", "env.js")
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "media", "styles.css")
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${style}" />
</head><body class="env-editor">
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body></html>`;
  }
}

type EnvWebviewMessage =
  | { type: "ready" }
  | { type: "save"; environment: Environment };

function getNonce(): string {
  let t = "";
  for (let i = 0; i < 32; i++) {
    t += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
      Math.floor(Math.random() * 62)
    );
  }
  return t;
}
