import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";

const vsCodeTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--vscode-editor-background)",
    color: "var(--vscode-editor-foreground)",
    fontSize: "13px",
    fontFamily: "var(--vscode-editor-font-family, monospace)",
  },
  ".cm-content": {
    caretColor: "var(--vscode-editorCursor-foreground)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--vscode-editorGutter-background)",
    color: "var(--vscode-editorLineNumber-foreground)",
    border: "none",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--vscode-editor-selectionBackground) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--vscode-editor-lineHighlightBackground)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--vscode-editorCursor-foreground)",
  },
});

/** Muted JSON/token colors — aligned with VS Code theme, low contrast */
const subtleHighlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--rf-json-key)" },
  { tag: [t.string, t.special(t.string)], color: "var(--rf-json-string)" },
  { tag: t.number, color: "var(--rf-json-number)" },
  { tag: [t.bool, t.atom], color: "var(--rf-json-bool)" },
  { tag: [t.null, t.keyword], color: "var(--rf-json-null)" },
  { tag: [t.bracket, t.punctuation, t.separator], color: "var(--rf-json-punct)" },
  { tag: t.comment, color: "var(--rf-json-comment)", fontStyle: "italic" },
]);

const subtleSyntax = syntaxHighlighting(subtleHighlight, { fallback: true });

function createVariablePlugin(knownKeys: Set<string>) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view, knownKeys);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view, knownKeys);
        }
      }
      build(view: EditorView, keys: Set<string>) {
        const re = /\{\{(\s*[\w.-]+\s*)\}\}/g;
        const text = view.state.doc.toString();
        const ranges = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const key = m[1]!.trim();
          ranges.push(
            Decoration.mark({
              class: keys.has(key) ? "cm-var-resolved" : "cm-var-unresolved",
            }).range(m.index, m.index + m[0].length)
          );
        }
        return Decoration.set(ranges, true);
      }
    },
    { decorations: (v) => v.decorations }
  );
}

function baseExtensions(
  knownKeys: Set<string>,
  onChange: (value: string) => void,
  extra: Extension[]
): Extension[] {
  return [
    vsCodeTheme,
    subtleSyntax,
    lineNumbers(),
    highlightActiveLine(),
    drawSelection(),
    placeholder("Enter body…"),
    createVariablePlugin(knownKeys),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        onChange(u.state.doc.toString());
      }
    }),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, indentWithTab]),
    ...extra,
  ];
}

export function createJsonEditor(
  parent: HTMLElement,
  initial: string,
  knownKeys: string[],
  onChange: (value: string) => void
): EditorView {
  const keys = new Set(knownKeys);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: baseExtensions(keys, onChange, [
        json(),
        linter(jsonParseLinter()),
        lintGutter(),
        closeBrackets(),
      ]),
    }),
  });
}

export function createTextEditor(
  parent: HTMLElement,
  initial: string,
  knownKeys: string[],
  onChange: (value: string) => void
): EditorView {
  const keys = new Set(knownKeys);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: baseExtensions(keys, onChange, []),
    }),
  });
}

export function createReadonlyEditor(
  parent: HTMLElement,
  content: string,
  asJson: boolean
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: content,
      extensions: [
        vsCodeTheme,
        subtleSyntax,
        lineNumbers(),
        drawSelection(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        ...(asJson ? [json()] : []),
      ],
    }),
  });
}

export function formatJson(view: EditorView): void {
  try {
    const parsed = JSON.parse(view.state.doc.toString());
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: JSON.stringify(parsed, null, 2),
      },
    });
  } catch {
    /* shown by linter */
  }
}

export function minifyJson(view: EditorView): void {
  try {
    const parsed = JSON.parse(view.state.doc.toString());
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: JSON.stringify(parsed),
      },
    });
  } catch {
    /* ignore */
  }
}

export function destroyEditor(view: EditorView | undefined): void {
  view?.destroy();
}

export function setEditorDoc(view: EditorView, doc: string): void {
  if (view.state.doc.toString() === doc) {
    return;
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc },
  });
}
