import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type {
  ApiError,
  ApiRequest,
  ApiResponse,
  CollectionTreeNode,
  Environment,
  HistoryEntry,
} from "../types";
import { createDefaultRequest } from "../views/treeProvider";

const COLLECTIONS_FILE = "collections.json";
const ENVIRONMENTS_FILE = "environments.json";
const HISTORY_FILE = "history.json";
const UI_FILE = "ui.json";
const MAX_HISTORY = 50;

interface UiPreferences {
  splitPercent?: number;
}

interface EnvironmentsFile {
  active: string;
  environments: Environment[];
}

export class ReqFlowStore {
  private collections: CollectionTreeNode[] = [];
  private environmentsFile: EnvironmentsFile = {
    active: "local",
    environments: [],
  };
  private history: HistoryEntry[] = [];
  private ui: UiPreferences = { splitPercent: 45 };
  private loaded = false;

  constructor(private readonly storageUri: vscode.Uri) {}

  getStorageUri(): vscode.Uri {
    return this.storageUri;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await vscode.workspace.fs.createDirectory(this.storageUri);
    this.collections = normalizeCollections(
      await this.readJson(COLLECTIONS_FILE, this.defaultCollections())
    );
    this.environmentsFile = await this.readJson(
      ENVIRONMENTS_FILE,
      this.defaultEnvironments()
    );
    this.history = (
      await this.readJson<HistoryEntry[]>(HISTORY_FILE, [])
    ).map(normalizeHistoryEntry);
    this.ui = await this.readJson(UI_FILE, { splitPercent: 45 });
    this.loaded = true;
  }

  getUiPreference(): UiPreferences {
    return this.ui;
  }

  async setUiPreference(partial: UiPreferences): Promise<void> {
    this.ui = { ...this.ui, ...partial };
    await this.writeJson(UI_FILE, this.ui);
  }

  async addEnvironment(name: string): Promise<void> {
    if (this.environmentsFile.environments.some((e) => e.name === name)) {
      return;
    }
    this.environmentsFile.environments.push({ name, variables: {} });
    await this.writeJson(ENVIRONMENTS_FILE, this.environmentsFile);
  }

  async deleteEnvironment(name: string): Promise<void> {
    this.environmentsFile.environments = this.environmentsFile.environments.filter(
      (e) => e.name !== name
    );
    if (this.environmentsFile.active === name) {
      this.environmentsFile.active =
        this.environmentsFile.environments[0]?.name ?? "";
    }
    await this.writeJson(ENVIRONMENTS_FILE, this.environmentsFile);
  }

  async duplicateEnvironment(name: string): Promise<Environment | undefined> {
    const env = this.environmentsFile.environments.find((e) => e.name === name);
    if (!env) {
      return undefined;
    }
    const copy: Environment = {
      ...structuredClone(env),
      name: `${name}-copy`,
    };
    this.environmentsFile.environments.push(copy);
    await this.writeJson(ENVIRONMENTS_FILE, this.environmentsFile);
    return copy;
  }

  getCollections(): CollectionTreeNode[] {
    return this.collections;
  }

  getHistory(): HistoryEntry[] {
    return this.history;
  }

  getEnvironments(): Environment[] {
    return this.environmentsFile.environments;
  }

  getActiveEnvironmentName(): string {
    return this.environmentsFile.active;
  }

  getActiveEnvironment(): Environment {
    const env =
      this.environmentsFile.environments.find(
        (e) => e.name === this.environmentsFile.active
      ) ?? this.environmentsFile.environments[0];
    return env ?? { name: "local", variables: {} };
  }

  getVariableKeys(): string[] {
    const keys = new Set<string>();
    for (const env of this.environmentsFile.environments) {
      Object.keys(env.variables).forEach((k) => keys.add(k));
    }
    return [...keys];
  }

  async setActiveEnvironment(name: string): Promise<void> {
    if (!this.environmentsFile.environments.some((e) => e.name === name)) {
      return;
    }
    this.environmentsFile.active = name;
    await this.writeJson(ENVIRONMENTS_FILE, this.environmentsFile);
  }

  async upsertEnvironment(env: Environment): Promise<void> {
    const idx = this.environmentsFile.environments.findIndex(
      (e) => e.name === env.name
    );
    if (idx >= 0) {
      this.environmentsFile.environments[idx] = env;
    } else {
      this.environmentsFile.environments.push(env);
    }
    await this.writeJson(ENVIRONMENTS_FILE, this.environmentsFile);
  }

  findRequest(id: string): { request: ApiRequest; node: CollectionTreeNode } | undefined {
    for (const root of this.collections) {
      const found = walkFindRequest(root, id);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  async saveRequest(request: ApiRequest): Promise<ApiRequest> {
    const existing = this.findRequest(request.id);
    if (existing) {
      existing.node.name = request.name;
      existing.node.request = { ...request };
      await this.writeJson(COLLECTIONS_FILE, this.collections);
      return existing.node.request!;
    }

    const root = this.collections[0];
    if (!root) {
      this.collections.push(this.defaultCollections()[0]!);
    }
    const target = this.collections[0]!;
    if (!target.children) {
      target.children = [];
    }
    const node: CollectionTreeNode = {
      id: request.id,
      name: request.name,
      type: "request",
      request: { ...request },
    };
    target.children.push(node);
    await this.writeJson(COLLECTIONS_FILE, this.collections);
    return node.request!;
  }

  async addCollection(name: string): Promise<void> {
    this.collections.push({
      id: randomUUID(),
      name,
      type: "collection",
      children: [],
    });
    await this.writeJson(COLLECTIONS_FILE, this.collections);
  }

  async addFolder(parentId: string, name: string): Promise<void> {
    const parent = findNode(this.collections, parentId);
    if (!parent || (parent.type !== "collection" && parent.type !== "folder")) {
      return;
    }
    parent.children ??= [];
    parent.children.push({
      id: randomUUID(),
      name,
      type: "folder",
      children: [],
    });
    await this.writeJson(COLLECTIONS_FILE, this.collections);
  }

  async addRequest(parentId: string, request?: ApiRequest): Promise<ApiRequest> {
    const parent = findNode(this.collections, parentId);
    if (!parent || (parent.type !== "collection" && parent.type !== "folder")) {
      const root = this.collections[0];
      if (!root) {
        throw new Error("No collection");
      }
      return this.addRequest(root.id, request);
    }
    const req = request ?? createDefaultRequest("New request");
    parent.children ??= [];
    parent.children.push({
      id: req.id,
      name: req.name,
      type: "request",
      request: req,
    });
    await this.writeJson(COLLECTIONS_FILE, this.collections);
    return req;
  }

  async renameNode(nodeId: string, name: string): Promise<void> {
    const node = findNode(this.collections, nodeId);
    if (!node) {
      return;
    }
    node.name = name;
    if (node.type === "request" && node.request) {
      node.request.name = name;
    }
    await this.writeJson(COLLECTIONS_FILE, this.collections);
  }

  async deleteNode(nodeId: string): Promise<void> {
    this.collections = deleteFromTree(this.collections, nodeId);
    await this.writeJson(COLLECTIONS_FILE, this.collections);
  }

  async duplicateRequest(nodeId: string): Promise<ApiRequest | undefined> {
    const node = findNode(this.collections, nodeId);
    if (!node?.request || node.type !== "request") {
      return undefined;
    }
    const copy: ApiRequest = {
      ...structuredClone(node.request),
      id: randomUUID(),
      name: `${node.request.name} (copy)`,
    };
    const parent = findParent(this.collections, nodeId);
    if (!parent?.children) {
      return undefined;
    }
    parent.children.push({
      id: copy.id,
      name: copy.name,
      type: "request",
      request: copy,
    });
    await this.writeJson(COLLECTIONS_FILE, this.collections);
    return copy;
  }

  async pushHistory(payload: {
    request: ApiRequest;
    response?: ApiResponse;
    error?: ApiError;
    status?: number;
    timeMs?: number;
    environment?: string;
  }): Promise<void> {
    const entry: HistoryEntry = normalizeHistoryEntry({
      id: randomUUID(),
      timestamp: Date.now(),
      request: normalizeApiRequest(structuredClone(payload.request)),
      response: payload.response ? structuredClone(payload.response) : undefined,
      error: payload.error ? structuredClone(payload.error) : undefined,
      status: payload.status,
      timeMs: payload.timeMs,
      environment: payload.environment,
    });
    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }
    await this.writeJson(HISTORY_FILE, this.history);
  }

  async clearHistory(): Promise<void> {
    this.history = [];
    await this.writeJson(HISTORY_FILE, this.history);
  }

  private defaultCollections(): CollectionTreeNode[] {
    const sample = createDefaultRequest("Sample GET");
    sample.url = "{{baseUrl}}/get";
    return [
      {
        id: randomUUID(),
        name: "My API",
        type: "collection",
        children: [
          {
            id: sample.id,
            name: sample.name,
            type: "request",
            request: sample,
          },
        ],
      },
    ];
  }

  private defaultEnvironments(): EnvironmentsFile {
    return {
      active: "local",
      environments: [
        {
          name: "local",
          variables: {
            baseUrl: "https://httpbin.org",
            token: "",
          },
          defaultHeaders: [],
        },
        {
          name: "staging",
          variables: {
            baseUrl: "https://staging.example.com",
            token: "",
          },
        },
        {
          name: "prod",
          variables: {
            baseUrl: "https://api.example.com",
            token: "",
          },
        },
      ],
    };
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    const uri = vscode.Uri.joinPath(this.storageUri, file);
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(raw).toString("utf8")) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    const uri = vscode.Uri.joinPath(this.storageUri, file);
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(data, null, 2), "utf8")
    );
  }
}

function walkFindRequest(
  node: CollectionTreeNode,
  id: string
): { request: ApiRequest; node: CollectionTreeNode } | undefined {
  if (node.type === "request" && node.request?.id === id) {
    return { request: node.request, node };
  }
  for (const child of node.children ?? []) {
    const found = walkFindRequest(child, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findNode(
  roots: CollectionTreeNode[],
  id: string
): CollectionTreeNode | undefined {
  for (const root of roots) {
    if (root.id === id) {
      return root;
    }
    for (const child of root.children ?? []) {
      const found = findNodeInSubtree(child, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function findNodeInSubtree(
  node: CollectionTreeNode,
  id: string
): CollectionTreeNode | undefined {
  if (node.id === id) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findNodeInSubtree(child, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findParent(
  roots: CollectionTreeNode[],
  childId: string,
  parent?: CollectionTreeNode
): CollectionTreeNode | undefined {
  for (const root of roots) {
    if (root.id === childId) {
      return parent;
    }
    const found = findParentInSubtree(root, childId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findParentInSubtree(
  node: CollectionTreeNode,
  childId: string
): CollectionTreeNode | undefined {
  for (const child of node.children ?? []) {
    if (child.id === childId) {
      return node;
    }
    const found = findParentInSubtree(child, childId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function deleteFromTree(
  roots: CollectionTreeNode[],
  id: string
): CollectionTreeNode[] {
  return roots
    .filter((r) => r.id !== id)
    .map((r) => ({
      ...r,
      children: r.children ? deleteFromTree(r.children, id) : undefined,
    }));
}

function normalizeCollections(roots: CollectionTreeNode[]): CollectionTreeNode[] {
  return roots.map((n) => {
    const node = { ...n };
    if (node.children) {
      node.children = normalizeCollections(node.children);
    }
    if (node.type === "request" && node.request) {
      node.request = {
        ...node.request,
        body: {
          type: node.request.body?.type ?? "none",
          content: node.request.body?.content ?? "",
          form: node.request.body?.form ?? [],
        },
      };
    }
    return node;
  });
}

export function normalizeApiRequest(req: ApiRequest): ApiRequest {
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

function normalizeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    request: normalizeApiRequest(entry.request),
    response: entry.response,
    error: entry.error,
  };
}

export function methodThemeColor(method: string): vscode.ThemeColor {
  switch (method) {
    case "GET":
      return new vscode.ThemeColor("charts.blue");
    case "POST":
      return new vscode.ThemeColor("charts.green");
    case "PUT":
      return new vscode.ThemeColor("charts.orange");
    case "PATCH":
      return new vscode.ThemeColor("charts.yellow");
    case "DELETE":
      return new vscode.ThemeColor("charts.red");
    default:
      return new vscode.ThemeColor("foreground");
  }
}
