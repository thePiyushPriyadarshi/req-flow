import type { Environment, KeyValue } from "../src/types";

declare const acquireVsCodeApi: () => {
  postMessage: (msg: unknown) => void;
};

const vscode = acquireVsCodeApi();
const app = document.getElementById("app")!;

function emptyRow(): KeyValue {
  return { key: "", value: "", enabled: true };
}

function fromRecord(rec: Record<string, string>): KeyValue[] {
  const rows = Object.entries(rec).map(([key, value]) => ({
    key,
    value,
    enabled: true,
  }));
  return rows.length ? rows : [emptyRow()];
}

function toRecord(rows: KeyValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.enabled && r.key.trim()) {
      out[r.key.trim()] = r.value;
    }
  }
  return out;
}

let envName = "";
let variables: KeyValue[] = [emptyRow()];
let defaultHeaders: KeyValue[] = [emptyRow()];

function render(): void {
  app.innerHTML = `
    <header class="panel-header">
      <label class="field field-inline">
        <span class="text-label">Environment</span>
        <input class="rf-input rf-input-title" id="env-name" value="${escAttr(envName)}" aria-label="Environment name" />
      </label>
      <div class="panel-header-actions">
        <button type="button" class="btn btn-primary" id="save">Save</button>
      </div>
    </header>
    <h2 class="section-title">Variables</h2>
    ${kvTable("vars", variables)}
    <h2 class="section-title">Default headers</h2>
    ${kvTable("headers", defaultHeaders)}
  `;
  bind();
}

function kvTable(id: string, rows: KeyValue[]): string {
  return `<div class="kv-table-wrap surface"><table class="kv-table" data-id="${id}">
    <thead><tr><th class="col-check"></th><th>Variable</th><th>Value</th><th class="col-action"></th></tr></thead>
    <tbody>${rows
      .map(
        (r, i) => `<tr data-i="${i}">
      <td class="col-check"><input type="checkbox" class="kv-check" ${r.enabled ? "checked" : ""} aria-label="Enable row" /></td>
      <td><input class="rf-input rf-input-sm k" value="${escAttr(r.key)}" placeholder="Key" /></td>
      <td><input class="rf-input rf-input-sm v" value="${escAttr(r.value)}" placeholder="Value" /></td>
      <td class="col-action"><button type="button" class="btn btn-icon-only btn-ghost rm" aria-label="Remove row">×</button></td>
    </tr>`
      )
      .join("")}</tbody></table>
    <div class="kv-table-footer"><button type="button" class="btn btn-ghost btn-sm" data-add="${id}">Add row</button></div></div>`;
}

function readTable(id: string): KeyValue[] {
  const table = app.querySelector(`[data-id="${id}"]`)!;
  const rows: KeyValue[] = [];
  table.querySelectorAll("tbody tr").forEach((tr) => {
    rows.push({
      enabled: (tr.querySelector(".kv-check") as HTMLInputElement)?.checked ?? true,
      key: (tr.querySelector(".k") as HTMLInputElement).value,
      value: (tr.querySelector(".v") as HTMLInputElement).value,
    });
  });
  return rows.length ? rows : [emptyRow()];
}

function bind(): void {
  document.getElementById("save")!.addEventListener("click", () => {
    variables = readTable("vars");
    defaultHeaders = readTable("headers");
    const name = (document.getElementById("env-name") as HTMLInputElement).value.trim();
    const environment: Environment = {
      name,
      variables: toRecord(variables),
      defaultHeaders: defaultHeaders.filter((h) => h.key.trim()),
    };
    vscode.postMessage({ type: "save", environment });
  });
  app.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.add!;
      if (id === "vars") {
        variables = [...readTable("vars"), emptyRow()];
      } else {
        defaultHeaders = [...readTable("headers"), emptyRow()];
      }
      render();
    });
  });
  app.querySelectorAll(".rm").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tr = btn.closest("tr")!;
      const table = tr.closest("table")!;
      const id = table.getAttribute("data-id")!;
      const i = Number(tr.getAttribute("data-i"));
      const rows = readTable(id).filter((_, idx) => idx !== i);
      if (id === "vars") {
        variables = rows.length ? rows : [emptyRow()];
      } else {
        defaultHeaders = rows.length ? rows : [emptyRow()];
      }
      render();
    });
  });
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

window.addEventListener("message", (e) => {
  if (e.data.type === "init") {
    const env = e.data.environment as Environment;
    envName = env.name;
    variables = fromRecord(env.variables);
    defaultHeaders = env.defaultHeaders?.length
      ? env.defaultHeaders
      : [emptyRow()];
    render();
  }
});

vscode.postMessage({ type: "ready" });
render();
