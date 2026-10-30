import * as vscode from "vscode";
import type { Environment } from "../types";
import type { ReqFlowStore } from "../storage/store";

export class EnvironmentTreeItem extends vscode.TreeItem {
  constructor(public readonly env: Environment, active: boolean) {
    super(env.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "environment";
    this.iconPath = new vscode.ThemeIcon(
      active ? "record" : "circle-outline",
      active ? new vscode.ThemeColor("charts.green") : undefined
    );
    this.description = active ? "active" : undefined;
    this.command = {
      command: "reqflow.setActiveEnvironment",
      title: "Set active",
      arguments: [env.name],
    };
  }
}

export class EnvironmentsTreeProvider
  implements vscode.TreeDataProvider<EnvironmentTreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: ReqFlowStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: EnvironmentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<EnvironmentTreeItem[]> {
    const active = this.store.getActiveEnvironmentName();
    return Promise.resolve(
      this.store.getEnvironments().map((e) => new EnvironmentTreeItem(e, e.name === active))
    );
  }
}
