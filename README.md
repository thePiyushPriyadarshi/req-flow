# ReqFlow

**Test APIs in VS Code. Simple, local, fast.**

ReqFlow is a minimal REST client: send a request, read the response, save requests locally. No accounts, no cloud sync.

## Quick start

1. `npm install` && `npm run compile`
2. Press **F5** (Extension Development Host)
3. Open **ReqFlow** in the activity bar → **Sample GET**
4. **Send** (`Cmd/Ctrl+Enter`) · **Save** to collections · **Env:** status bar

Sample URL: `{{baseUrl}}/get` (`baseUrl` is `https://httpbin.org` in **local**).

## Features (v0.2)

- **Builder:** Params, headers (bulk paste, auto rows), JSON/text/form body (CodeMirror: lint, prettify/minify, `Shift+Alt+F` on JSON)
- **Auth:** Bearer / Basic with auto `Authorization`
- **Collections + history** in VS Code global storage (sidebar context menus)
- **Environments** with `{{variable}}` substitution and unresolved highlighting

## Development

| Script | Purpose |
|--------|---------|
| `npm run compile` | Bundle extension + webview |
| `npm run watch` | Rebuild on change |
| `npm run lint` | Typecheck |
| `npm run vsix` | Output `reqflow-0.2.0.vsix` |

Install VSIX: Extensions → **Install from VSIX…** or `code --install-extension reqflow-0.2.0.vsix`.

## Roadmap

Next up from the plan: cURL copy/import (Phase 5), export collection JSON, drag-and-drop in the tree.

## License

MIT
