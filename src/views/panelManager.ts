import * as vscode from "vscode";
import type { ApiRequest, HistoryEntry } from "../types";
import { normalizeApiRequest } from "../storage/store";
import type { RequestPanelDeps } from "./requestPanel";
import { RequestPanel } from "./requestPanel";

const PREVIEW_KEY = "__reqflow_preview__";

export class PanelManager {
  private static panels = new Map<string, RequestPanel>();
  private static previewPanel: RequestPanel | undefined;
  private static activePanel: RequestPanel | undefined;

  static open(
    extensionUri: vscode.Uri,
    deps: RequestPanelDeps,
    request: ApiRequest,
    options: { preview?: boolean; pin?: boolean } = {}
  ): RequestPanel {
    const pin = options.pin ?? !options.preview;
    const storageKey = pin ? request.id : PREVIEW_KEY;
    const existing = this.panels.get(storageKey);
    if (existing) {
      existing.loadRequest(request, { preview: !pin });
      existing.reveal();
      this.activePanel = existing;
      return existing;
    }

    if (!pin) {
      if (this.previewPanel) {
        this.previewPanel.loadRequest(request, { preview: true });
        this.activePanel = this.previewPanel;
        return this.previewPanel;
      }
      const panel = RequestPanel.create(
        extensionUri,
        deps,
        request,
        { preview: true }
      );
      this.previewPanel = panel;
      this.panels.set(PREVIEW_KEY, panel);
      panel.onDidDispose(() => {
        if (this.previewPanel === panel) {
          this.previewPanel = undefined;
        }
        this.panels.delete(PREVIEW_KEY);
      });
      this.activePanel = panel;
      return panel;
    }

    const panel = RequestPanel.create(extensionUri, deps, request, { preview: false });
    panel.setPanelStorageKey(request.id);
    this.panels.set(request.id, panel);
    panel.onDidDispose(() => {
      this.panels.delete(request.id);
      if (this.activePanel === panel) {
        this.activePanel = undefined;
      }
    });
    panel.onDidPin(() => {
      if (this.previewPanel === panel) {
        this.previewPanel = undefined;
        this.panels.delete(PREVIEW_KEY);
        panel.setPanelStorageKey(request.id);
        this.panels.set(request.id, panel);
      }
    });
    this.activePanel = panel;
    return panel;
  }

  static openHistory(
    extensionUri: vscode.Uri,
    deps: RequestPanelDeps,
    entry: HistoryEntry
  ): RequestPanel {
    const key = `history:${entry.id}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.loadHistoryEntry(entry);
      existing.reveal();
      this.activePanel = existing;
      return existing;
    }

    const req = normalizeApiRequest(entry.request);
    req.id = `history-${entry.id}`;
    const panel = RequestPanel.create(extensionUri, deps, req, { preview: false });
    panel.setPanelStorageKey(key);
    panel.loadHistoryEntry(entry);
    this.panels.set(key, panel);
    panel.onDidDispose(() => {
      this.panels.delete(key);
      if (this.activePanel === panel) {
        this.activePanel = undefined;
      }
    });
    this.activePanel = panel;
    return panel;
  }

  static getActive(): RequestPanel | undefined {
    return this.activePanel ?? this.previewPanel ?? RequestPanel.getFocused();
  }

  static cancelActive(): void {
    this.getActive()?.cancelRequest();
  }

  static refreshAllThemes(): void {
    for (const p of this.panels.values()) {
      p.refreshTheme();
    }
  }

  static notifyEnvChange(): void {
    for (const p of this.panels.values()) {
      p.notifyEnvChange();
    }
  }

  static syncRequestName(requestId: string, name: string): void {
    this.panels.get(requestId)?.syncRequestName(name);
  }
}
