import * as vscode from "vscode";
import type { ReqFlowStore } from "../storage/store";

export class EnvironmentStatusBar implements vscode.Disposable {
  private envItem: vscode.StatusBarItem;
  private sendingItem: vscode.StatusBarItem;

  constructor(private readonly store: ReqFlowStore) {
    this.envItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50
    );
    this.envItem.command = "reqflow.selectEnvironment";
    this.sendingItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      49
    );
    this.sendingItem.command = "reqflow.cancelRequest";
    this.sendingItem.text = "$(sync~spin) Sending…";
    this.sendingItem.tooltip = "Cancel request";
  }

  show(): void {
    this.updateLabel();
    this.envItem.show();
  }

  updateLabel(): void {
    const name = this.store.getActiveEnvironmentName();
    this.envItem.text = name ? `$(zap) Env: ${name}` : "$(zap) No environment";
    this.envItem.tooltip = "Switch ReqFlow environment";
  }

  setSending(sending: boolean): void {
    if (sending) {
      this.sendingItem.show();
    } else {
      this.sendingItem.hide();
    }
  }

  dispose(): void {
    this.envItem.dispose();
    this.sendingItem.dispose();
  }
}

export async function pickEnvironment(store: ReqFlowStore): Promise<string | undefined> {
  const envs = store.getEnvironments();
  const picked = await vscode.window.showQuickPick(
    envs.map((e) => ({
      label: e.name,
      description: e.variables.baseUrl ? `baseUrl → ${e.variables.baseUrl}` : undefined,
    })),
    { placeHolder: "Active environment" }
  );
  return picked?.label;
}
