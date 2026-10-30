import * as vscode from "vscode";
import { fromCurl } from "./http/curl";
import { ReqFlowStore } from "./storage/store";
import { EnvironmentEditorPanel } from "./views/environmentEditorPanel";
import {
  EnvironmentStatusBar,
  pickEnvironment,
} from "./views/environmentStatusBar";
import { EnvironmentsTreeProvider } from "./views/environmentsTree";
import { PanelManager } from "./views/panelManager";
import {
  CollectionsTreeProvider,
  createDefaultRequest,
  HistoryTreeProvider,
  ReqFlowTreeItem,
} from "./views/treeProvider";
import type { ApiRequest, HistoryEntry } from "./types";

let store: ReqFlowStore;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  store = new ReqFlowStore(context.globalStorageUri);
  await store.ensureLoaded();

  const collections = new CollectionsTreeProvider(store);
  const history = new HistoryTreeProvider(store);
  const environments = new EnvironmentsTreeProvider(store);
  const statusBar = new EnvironmentStatusBar(store);

  const refreshAll = (): void => {
    collections.refresh();
    history.refresh();
    environments.refresh();
  };

  const panelDeps = {
    store,
    onSaved: refreshAll,
    onHistory: () => history.refresh(),
    onEnvChange: () => {
      statusBar.updateLabel();
      environments.refresh();
      PanelManager.notifyEnvChange();
    },
    onSendingChange: (sending: boolean) => statusBar.setSending(sending),
  };

  const openRequest = (request: ApiRequest, preview = true): void => {
    PanelManager.open(context.extensionUri, panelDeps, request, {
      preview,
      pin: !preview,
    });
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("reqflow.collections", collections),
    vscode.window.registerTreeDataProvider("reqflow.history", history),
    vscode.window.registerTreeDataProvider("reqflow.environments", environments),
    statusBar,
    vscode.commands.registerCommand("reqflow.openPanel", () => {
      openRequest(createDefaultRequest("Untitled Request"), false);
    }),
    vscode.commands.registerCommand("reqflow.newRequest", async (item?: ReqFlowTreeItem) => {
      const parentId =
        item?.node && item.node.type !== "request"
          ? item.node.id
          : store.getCollections()[0]?.id;
      const req = parentId
        ? await store.addRequest(parentId, createDefaultRequest("Untitled Request"))
        : createDefaultRequest("Untitled Request");
      refreshAll();
      openRequest(req, false);
    }),
    vscode.commands.registerCommand(
      "reqflow.openRequest",
      (request: ApiRequest, preview?: boolean) => {
        openRequest(request, preview !== false);
      }
    ),
    vscode.commands.registerCommand("reqflow.openRequestPinned", (request: ApiRequest) => {
      openRequest(request, false);
    }),
    vscode.commands.registerCommand(
      "reqflow.openHistoryEntry",
      (entry: HistoryEntry) => {
        PanelManager.openHistory(context.extensionUri, panelDeps, entry);
      }
    ),
    vscode.commands.registerCommand("reqflow.send", () => {
      PanelManager.getActive()?.sendFromCommand();
    }),
    vscode.commands.registerCommand("reqflow.cancelRequest", () => {
      PanelManager.cancelActive();
    }),
    vscode.commands.registerCommand("reqflow.saveRequest", () => {
      PanelManager.getActive()?.triggerSave();
    }),
    vscode.commands.registerCommand("reqflow.renameRequest", async () => {
      await PanelManager.getActive()?.promptRename();
    }),
    vscode.commands.registerCommand("reqflow.focusUrl", () => {
      PanelManager.getActive()?.focusUrl();
    }),
    vscode.commands.registerCommand("reqflow.copyCurl", () => {
      PanelManager.getActive()?.copyCurl();
    }),
    vscode.commands.registerCommand("reqflow.importCurl", async () => {
      const curl = await vscode.window.showInputBox({
        prompt: "Paste cURL command",
        placeHolder: "curl -X GET https://...",
      });
      if (!curl) {
        return;
      }
      try {
        const parsed = fromCurl(curl);
        const req = createDefaultRequest("Imported request");
        if (parsed.method) {
          req.method = parsed.method;
        }
        if (parsed.url) {
          req.url = parsed.url;
        }
        if (parsed.headers) {
          req.headers = Object.entries(parsed.headers).map(([key, value]) => ({
            key,
            value,
            enabled: true,
          }));
        }
        if (parsed.body) {
          req.body.type = "json";
          req.body.content = parsed.body;
        }
        openRequest(req, false);
      } catch {
        void vscode.window.showErrorMessage("Could not parse cURL command");
      }
    }),
    vscode.commands.registerCommand("reqflow.newCollection", async () => {
      const name = await vscode.window.showInputBox({ prompt: "Collection name" });
      if (name) {
        await store.addCollection(name);
        refreshAll();
      }
    }),
    vscode.commands.registerCommand("reqflow.newFolder", async (item?: ReqFlowTreeItem) => {
      const parentId = item?.node.id ?? store.getCollections()[0]?.id;
      if (!parentId) {
        return;
      }
      const name = await vscode.window.showInputBox({ prompt: "Folder name" });
      if (name) {
        await store.addFolder(parentId, name);
        refreshAll();
      }
    }),
    vscode.commands.registerCommand("reqflow.renameNode", async (item: ReqFlowTreeItem) => {
      const name = await vscode.window.showInputBox({
        prompt: "New name",
        value: item.node.name,
      });
      if (name) {
        await store.renameNode(item.node.id, name);
        if (item.node.type === "request" && item.node.request) {
          PanelManager.syncRequestName(item.node.request.id, name);
        }
        refreshAll();
      }
    }),
    vscode.commands.registerCommand("reqflow.deleteNode", async (item: ReqFlowTreeItem) => {
      const isContainer =
        item.node.type !== "request" && (item.node.children?.length ?? 0) > 0;
      if (isContainer) {
        const ok = await vscode.window.showWarningMessage(
          `Delete "${item.node.name}" and its contents?`,
          { modal: true },
          "Delete"
        );
        if (ok !== "Delete") {
          return;
        }
      }
      await store.deleteNode(item.node.id);
      refreshAll();
    }),
    vscode.commands.registerCommand("reqflow.duplicateRequest", async (item: ReqFlowTreeItem) => {
      const copy = await store.duplicateRequest(item.node.id);
      if (copy) {
        refreshAll();
        openRequest(copy, false);
      }
    }),
    vscode.commands.registerCommand("reqflow.clearHistory", async () => {
      const ok = await vscode.window.showWarningMessage(
        "Clear all history?",
        { modal: true },
        "Clear"
      );
      if (ok === "Clear") {
        await store.clearHistory();
        history.refresh();
      }
    }),
    vscode.commands.registerCommand("reqflow.selectEnvironment", async () => {
      const picked = await pickEnvironment(store);
      if (picked) {
        await store.setActiveEnvironment(picked);
        panelDeps.onEnvChange!();
      }
    }),
    vscode.commands.registerCommand("reqflow.setActiveEnvironment", async (name: string) => {
      await store.setActiveEnvironment(name);
      panelDeps.onEnvChange!();
    }),
    vscode.commands.registerCommand("reqflow.newEnvironment", async () => {
      const name = await vscode.window.showInputBox({ prompt: "Environment name" });
      if (name) {
        await store.addEnvironment(name);
        refreshAll();
      }
    }),
    vscode.commands.registerCommand("reqflow.editEnvironment", (name?: string) => {
      EnvironmentEditorPanel.show(
        context.extensionUri,
        store,
        name ?? store.getActiveEnvironmentName(),
        refreshAll
      );
    }),
    vscode.commands.registerCommand("reqflow.manageEnvironments", () => {
      void vscode.commands.executeCommand(
        "reqflow.editEnvironment",
        store.getActiveEnvironmentName()
      );
    }),
    vscode.commands.registerCommand("reqflow.revealStorage", () => {
      void vscode.commands.executeCommand("revealInExplorer", store.getStorageUri());
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      PanelManager.refreshAllThemes();
    })
  );

  statusBar.show();
}

export function deactivate(): void {}
