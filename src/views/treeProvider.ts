import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { ApiRequest, CollectionTreeNode, HistoryEntry } from "../types";
import type { ReqFlowStore } from "../storage/store";
import { methodThemeColor } from "../storage/store";

export function formatMethodBadge(method: string): string {
  return method.toUpperCase().padEnd(6, "\u00a0");
}

export function requestDisplayName(req: ApiRequest): string {
  if (req.name && req.name !== "Untitled Request" && req.name !== "Untitled") {
    return req.name;
  }
  try {
    const u = new URL(req.url.replace(/\{\{[^}]+\}\}/g, "x"));
    return u.pathname || req.url;
  } catch {
    return req.url;
  }
}

export function createDefaultRequest(name = "Untitled request"): ApiRequest {
  return {
    id: randomUUID(),
    name,
    method: "GET",
    url: "{{baseUrl}}/get",
    params: [],
    headers: [],
    body: { type: "none", content: "", form: [] },
    auth: { type: "none" },
  };
}

export class CollectionsTreeProvider
  implements vscode.TreeDataProvider<ReqFlowTreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ReqFlowTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: ReqFlowStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ReqFlowTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ReqFlowTreeItem): Thenable<ReqFlowTreeItem[]> {
    const roots = this.store.getCollections();
    if (!element) {
      return Promise.resolve(roots.map((n) => this.nodeToItem(n)));
    }
    const node = element.node;
    if (node.type === "request") {
      return Promise.resolve([]);
    }
    return Promise.resolve((node.children ?? []).map((c) => this.nodeToItem(c)));
  }

  private nodeToItem(node: CollectionTreeNode): ReqFlowTreeItem {
    const collapsible =
      node.type === "request"
        ? vscode.TreeItemCollapsibleState.None
        : node.children?.length
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;

    const item = new ReqFlowTreeItem(node.name, collapsible, node);
    item.id = node.id;

    if (node.type === "request" && node.request) {
      const req = node.request;
      item.label = `${formatMethodBadge(req.method)}${requestDisplayName(req)}`;
      item.description = req.url.split(/[?#]/, 1)[0];
      item.tooltip = `${req.method} ${req.url}`;
      item.iconPath = new vscode.ThemeIcon("circle-filled", methodThemeColor(req.method));
      item.contextValue = "request";
      item.command = {
        command: "reqflow.openRequest",
        title: "Open Request",
        arguments: [req, true],
      };
    } else if (node.type === "folder") {
      item.iconPath = new vscode.ThemeIcon("folder");
      item.contextValue = "folder";
    } else {
      item.iconPath = new vscode.ThemeIcon("folder-library");
      item.contextValue = "collection";
    }
    return item;
  }
}

export class HistoryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: ReqFlowStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element) {
      const group = (element as HistoryGroupItem).entries;
      if (group) {
        return Promise.resolve(group.map((h) => this.entryToItem(h)));
      }
      return Promise.resolve([]);
    }
    const history = this.store.getHistory();
    if (history.length === 0) {
      const empty = new vscode.TreeItem("No history yet");
      empty.description = "Send a request to populate";
      empty.iconPath = new vscode.ThemeIcon("history");
      return Promise.resolve([empty]);
    }
    const groups = groupHistoryByDay(history);
    return Promise.resolve(
      groups.map(
        (g) =>
          new HistoryGroupItem(g.label, g.entries, vscode.TreeItemCollapsibleState.Expanded)
      )
    );
  }

  private entryToItem(entry: HistoryEntry): vscode.TreeItem {
    const req = entry.request;
    const item = new vscode.TreeItem(
      `${formatMethodBadge(req.method)}${requestDisplayName(req)}`,
      vscode.TreeItemCollapsibleState.None
    );
    const status = entry.status ?? 0;
    item.description = entry.status
      ? `${status} · ${entry.timeMs ?? 0}ms`
      : entry.error
        ? "Failed"
        : req.method;
    const tipLines = [new Date(entry.timestamp).toLocaleString()];
    if (entry.environment) {
      tipLines.push(`Env: ${entry.environment}`);
    }
    if (entry.response) {
      tipLines.push(`Response: ${entry.response.sizeBytes} B`);
    }
    if (entry.error) {
      tipLines.push(entry.error.message);
    }
    item.tooltip = tipLines.join("\n");
    item.iconPath = new vscode.ThemeIcon("history", methodThemeColor(req.method));
    item.command = {
      command: "reqflow.openHistoryEntry",
      title: "Open from history",
      arguments: [entry],
    };
    return item;
  }
}

class HistoryGroupItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly entries: HistoryEntry[],
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.iconPath = new vscode.ThemeIcon("calendar");
  }
}

function groupHistoryByDay(entries: HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  const buckets = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    let label = "Earlier";
    if (e.timestamp >= startToday) {
      label = "Today";
    } else if (e.timestamp >= startYesterday) {
      label = "Yesterday";
    }
    buckets.set(label, [...(buckets.get(label) ?? []), e]);
  }
  const order = ["Today", "Yesterday", "Earlier"];
  return order.filter((l) => buckets.has(l)).map((l) => ({ label: l, entries: buckets.get(l)! }));
}

export class ReqFlowTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly node: CollectionTreeNode
  ) {
    super(label, collapsibleState);
  }
}
