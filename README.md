# ReqFlow: REST API Client & HTTP Tester 

**Build, send, and inspect REST API requests in VS Code. No login required.**

ReqFlow is a lightweight REST API client and HTTP testing extension for VS Code. Create requests, test endpoints, inspect JSON responses, and organize API work with collections, environments, request history, and cURL import. It’s a focused Postman alternative for developers who want an API client inside their editor. **No login or account required.** Requests and data stay in VS Code global storage on your machine; ReqFlow has no cloud sync or telemetry.

![ReqFlow REST API client for VS Code showing the request builder, collections, response, and request history](media/preview.png)

## Features

### Request builder

- **Methods:** GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- **URL & query params** with enable/disable per row
- **Headers** table plus **Paste headers** for bulk import (e.g. from browser devtools)
- **Body:** none, JSON, raw text, or `application/x-www-form-urlencoded`
- **JSON editor** (CodeMirror): syntax highlight, parse lint, prettify / minify
- **Auth:** Bearer token or Basic (username/password) with automatic `Authorization` header

### Send & inspect

- **Send** with status, duration, and response size
- Response **body** and **headers** tabs
- **Cancel** in-flight requests (`Escape`)
- **History** of recent sends (last 50), reopenable from the sidebar

### Collections

- **Collections**, **folders**, and saved **requests** in the ReqFlow sidebar
- Context menus: new folder/request, rename, delete, duplicate, open pinned tab
- **Save** requests from the panel (`Cmd/Ctrl+S`)
- Sample collection on first run (**Sample GET** → `{{baseUrl}}/get`)

### Environments

- Named environments with **`{{variable}}`** substitution in URLs, params, headers, and body
- **Unresolved** placeholders highlighted in the UI
- **Status bar** picker for the active environment
- **Edit Environment Variables** editor for keys/values and optional default headers
- Built-in **local** environment with `baseUrl` → `https://httpbin.org`

### cURL

- **Copy as cURL** from a saved request or the open panel
- **Import from cURL** (Collections view toolbar or welcome link) to start a new request

### Keyboard shortcuts (request panel)

| Action        | Windows / Linux | macOS        |
|---------------|-----------------|--------------|
| Send          | `Ctrl+Enter`    | `Cmd+Enter`  |
| Save          | `Ctrl+S`        | `Cmd+S`      |
| Rename        | `F2`            | `F2`         |
| Focus URL     | `Ctrl+L`        | `Cmd+L`      |
| Cancel send   | `Escape`        | `Escape`     |
| New request   | `Ctrl+Alt+N`    | `Cmd+Alt+N`  |

## Quick start (users)

1. Install **ReqFlow: REST API Client & Tester** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=reqflow.reqflow) (or install a `.vsix` — see below).
2. Click the **ReqFlow** icon in the activity bar.
3. Open **Sample GET** under **Collections**, choose **local** in the status bar if needed, and press **Send**.

## Quick start (development)

```bash
npm install
npm run compile
```

Press **F5** to launch an **Extension Development Host**, then use the ReqFlow sidebar as above.

| Script              | Purpose                          |
|---------------------|----------------------------------|
| `npm run compile`   | Bundle extension + webview       |
| `npm run watch`     | Rebuild on file changes          |
| `npm run lint`      | Typecheck (`tsc --noEmit`)       |
| `npm run vsix`      | Package `reqflow-<version>.vsix` |
| `npm run publish`   | Publish to Marketplace (see below) |

**Install a local VSIX:** Extensions view → **⋯** → **Install from VSIX…**, or:

```bash
code --install-extension reqflow-1.0.0.vsix
```

**Reveal on-disk data:** Command Palette → **ReqFlow: Reveal Storage Folder**.

## Publish to the VS Code Marketplace

Publishing uses [Visual Studio Marketplace](https://marketplace.visualstudio.com/) and the [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce) CLI (already in this repo’s devDependencies).

### One-time setup

1. **Microsoft account** — sign in at [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage).
2. **Create a publisher** — [Manage Publishers](https://marketplace.visualstudio.com/manage/createpublisher).  
   The `publisher` field in `package.json` must match exactly (currently **`reqflow`**). Change one or the other if you use a different publisher id.
3. **Personal Access Token (PAT)** — [Azure DevOps](https://dev.azure.com) → User settings → **Personal access tokens** → New token with **Custom defined** scope → **Marketplace** → **Manage** (publish extensions).
4. **Log in with vsce** (from this repo root):

   ```bash
   npx vsce login reqflow
   ```

   Paste the PAT when prompted.

5. **Repository & icon (recommended before first publish)**  
   - Set `repository`, `bugs`, and `homepage` in `package.json` to your GitHub repo.  
   - Marketplace listing looks best with a **128×128 PNG** at `media/logo.png` and `"icon": "media/logo.png"` in `package.json` (SVG works in the activity bar; PNG is preferred for store search results).

### Pre-publish checklist

- [ ] Bump `version` in `package.json` (semver).
- [ ] Update `CHANGELOG.md`.
- [ ] `npm run compile` (also runs automatically via `vscode:prepublish`).
- [ ] `npm run vsix` and smoke-test the VSIX in a clean VS Code window.
- [ ] README is accurate (Marketplace shows the repo README).

### Publish

```bash
npm run publish
```

This runs `vsce publish --no-dependencies` (dependencies are bundled; dev files are excluded via `.vscodeignore`).

**Update an existing listing:** bump version and run `npm run publish` again.

**Unlisted / team testing:** share the `.vsix` from `npm run vsix` without publishing.

### Extension identity

| Field         | Value                          |
|---------------|--------------------------------|
| Name          | `reqflow`                      |
| Display name  | ReqFlow: REST API Client & Tester     |
| ID            | `reqflow.reqflow`              |

## Privacy & storage

Collections, environments, and history are stored under VS Code **global storage** for this extension (not in your workspace). Requests are sent with Node’s `fetch` from the extension host — use only on networks and APIs you trust.

## Roadmap

- Export / import collection JSON  
- Drag-and-drop reorder in the collections tree  
- Richer cURL import (multipart, cookies, more flags)

## License

MIT — see [LICENSE](LICENSE).
