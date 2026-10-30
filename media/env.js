"use strict";
(() => {
  // webview/env.ts
  var vscode = acquireVsCodeApi();
  var app = document.getElementById("app");
  function emptyRow() {
    return { key: "", value: "", enabled: true };
  }
  function fromRecord(rec) {
    const rows = Object.entries(rec).map(([key, value]) => ({
      key,
      value,
      enabled: true
    }));
    return rows.length ? rows : [emptyRow()];
  }
  function toRecord(rows) {
    const out = {};
    for (const r of rows) {
      if (r.enabled && r.key.trim()) {
        out[r.key.trim()] = r.value;
      }
    }
    return out;
  }
  var envName = "";
  var variables = [emptyRow()];
  var defaultHeaders = [emptyRow()];
  function render() {
    app.innerHTML = `
    <header class="panel-header">
      <label class="field field-inline">
        <span class="text-label">Environment</span>
        <input class="rf-input rf-input-title" id="env-name" value="${escAttr(envName)}" aria-label="Environment name" required />
      </label>
      <div class="panel-header-actions">
        <span class="env-save-status text-meta" id="env-save-status" role="status" aria-live="polite"></span>
        <button type="button" class="btn btn-primary" id="save">Save</button>
      </div>
    </header>
    <p class="env-intro text-meta">Use <code>{{variable}}</code> in request URLs, headers, and bodies. Default headers are added to each request in this environment.</p>
    <h2 class="section-title">Variables</h2>
    ${kvTable("vars", variables)}
    <h2 class="section-title">Default headers</h2>
    ${kvTable("headers", defaultHeaders)}
  `;
    bind();
  }
  function kvTable(id, rows) {
    return `<div class="kv-table-wrap surface"><table class="kv-table" data-id="${id}">
    <thead><tr><th class="col-check"></th><th>Variable</th><th>Value</th><th class="col-action"></th></tr></thead>
    <tbody>${rows.map(
      (r, i) => `<tr data-i="${i}">
      <td class="col-check"><input type="checkbox" class="kv-check" ${r.enabled ? "checked" : ""} aria-label="Enable row" /></td>
      <td><input class="rf-input rf-input-sm k" value="${escAttr(r.key)}" placeholder="Key" /></td>
      <td><input class="rf-input rf-input-sm v" value="${escAttr(r.value)}" placeholder="Value" /></td>
      <td class="col-action"><button type="button" class="btn btn-icon-only btn-ghost rm" aria-label="Remove row">\xD7</button></td>
    </tr>`
    ).join("")}</tbody></table>
    <div class="kv-table-footer"><button type="button" class="btn btn-ghost btn-sm" data-add="${id}">Add row</button></div></div>`;
  }
  function readTable(id) {
    const table = app.querySelector(`[data-id="${id}"]`);
    const rows = [];
    table.querySelectorAll("tbody tr").forEach((tr) => {
      rows.push({
        enabled: tr.querySelector(".kv-check")?.checked ?? true,
        key: tr.querySelector(".k").value,
        value: tr.querySelector(".v").value
      });
    });
    return rows.length ? rows : [emptyRow()];
  }
  function bind() {
    document.getElementById("save").addEventListener("click", () => {
      variables = readTable("vars");
      defaultHeaders = readTable("headers");
      const nameInput = document.getElementById("env-name");
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.setCustomValidity("Enter a name for this environment.");
        nameInput.reportValidity();
        return;
      }
      nameInput.setCustomValidity("");
      const status = document.getElementById("env-save-status");
      if (status) status.textContent = "Saving\u2026";
      const environment = {
        name,
        variables: toRecord(variables),
        defaultHeaders: defaultHeaders.filter((h) => h.key.trim())
      };
      vscode.postMessage({ type: "save", environment });
    });
    document.getElementById("env-name")?.addEventListener("input", (event) => {
      event.target.setCustomValidity("");
      const status = document.getElementById("env-save-status");
      if (status) status.textContent = "";
    });
    app.querySelectorAll(".kv-table input").forEach((input) => {
      const clearSavedStatus = () => {
        const status = document.getElementById("env-save-status");
        if (status) status.textContent = "";
      };
      input.addEventListener("input", clearSavedStatus);
      input.addEventListener("change", clearSavedStatus);
    });
    app.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const status = document.getElementById("env-save-status");
        if (status) status.textContent = "";
        const id = btn.dataset.add;
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
        const status = document.getElementById("env-save-status");
        if (status) status.textContent = "";
        const tr = btn.closest("tr");
        const table = tr.closest("table");
        const id = table.getAttribute("data-id");
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
  function escAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }
  window.addEventListener("message", (e) => {
    if (e.data.type === "init") {
      const env = e.data.environment;
      envName = env.name;
      variables = fromRecord(env.variables);
      defaultHeaders = env.defaultHeaders?.length ? env.defaultHeaders : [emptyRow()];
      render();
    } else if (e.data.type === "saved") {
      const status = document.getElementById("env-save-status");
      if (status) status.textContent = "Environment saved";
    }
  });
  vscode.postMessage({ type: "ready" });
  render();
})();
//# sourceMappingURL=env.js.map
