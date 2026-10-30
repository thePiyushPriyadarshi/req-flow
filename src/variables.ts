import type { ApiRequest, KeyValue } from "./types";

export function resolveVariables(
  input: string,
  variables: Record<string, string>
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const text = input.replace(/\{\{(\s*[\w.-]+\s*)\}\}/g, (_match, name: string) => {
    const key = name.trim();
    const value = variables[key];
    if (value === undefined) {
      unresolved.push(key);
      return `{{${key}}}`;
    }
    return value;
  });
  return { text, unresolved: [...new Set(unresolved)] };
}

export function buildOutboundFromDraft(
  draft: ApiRequest,
  variables: Record<string, string>,
  envDefaultHeaders: KeyValue[] = []
): {
  method: ApiRequest["method"];
  url: string;
  headers: Record<string, string>;
  body?: string;
  unresolved: string[];
} {
  const allUnresolved: string[] = [];
  const urlResult = resolveVariables(draft.url, variables);
  allUnresolved.push(...urlResult.unresolved);

  const headers: Record<string, string> = {};

  for (const row of envDefaultHeaders) {
    if (!row.enabled || !row.key.trim()) {
      continue;
    }
    const k = resolveVariables(row.key, variables);
    const v = resolveVariables(row.value, variables);
    allUnresolved.push(...k.unresolved, ...v.unresolved);
    headers[k.text] = v.text;
  }

  for (const row of draft.headers) {
    if (!row.enabled || !row.key.trim()) {
      continue;
    }
    const k = resolveVariables(row.key, variables);
    const v = resolveVariables(row.value, variables);
    allUnresolved.push(...k.unresolved, ...v.unresolved);
    headers[k.text] = v.text;
  }

  if (draft.auth.type === "bearer" && draft.auth.token) {
    const token = resolveVariables(draft.auth.token, variables);
    allUnresolved.push(...token.unresolved);
    if (!headers["Authorization"] && !headers["authorization"]) {
      headers["Authorization"] = `Bearer ${token.text}`;
    }
  }

  if (draft.auth.type === "basic" && draft.auth.username) {
    const user = resolveVariables(draft.auth.username, variables);
    const pass = resolveVariables(draft.auth.password ?? "", variables);
    allUnresolved.push(...user.unresolved, ...pass.unresolved);
    if (!headers["Authorization"] && !headers["authorization"]) {
      const encoded = Buffer.from(`${user.text}:${pass.text}`).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    }
  }

  let body: string | undefined;
  if (draft.body.type === "json" || draft.body.type === "text") {
    const resolved = resolveVariables(draft.body.content, variables);
    allUnresolved.push(...resolved.unresolved);
    body = resolved.text;
    if (draft.body.type === "json" && !headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (draft.body.type === "text" && !headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "text/plain; charset=utf-8";
    }
  } else if (draft.body.type === "form") {
    const params = new URLSearchParams();
    for (const row of draft.body.form ?? []) {
      if (!row.enabled || !row.key.trim()) {
        continue;
      }
      const k = resolveVariables(row.key, variables);
      const v = resolveVariables(row.value, variables);
      allUnresolved.push(...k.unresolved, ...v.unresolved);
      params.append(k.text, v.text);
    }
    body = params.toString();
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  }

  const url = appendQueryParams(urlResult.text, draft.params, variables, allUnresolved);

  return {
    method: draft.method,
    url,
    headers,
    body,
    unresolved: [...new Set(allUnresolved)],
  };
}

function appendQueryParams(
  baseUrl: string,
  params: ApiRequest["params"],
  variables: Record<string, string>,
  unresolved: string[]
): string {
  try {
    const url = new URL(baseUrl);
    for (const row of params) {
      if (!row.enabled || !row.key.trim()) {
        continue;
      }
      const k = resolveVariables(row.key, variables);
      const v = resolveVariables(row.value, variables);
      unresolved.push(...k.unresolved, ...v.unresolved);
      url.searchParams.append(k.text, v.text);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}
