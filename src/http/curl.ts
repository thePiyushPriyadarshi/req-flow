import type { HttpMethod, OutboundRequest } from "../types";

export function toCurl(req: OutboundRequest): string {
  const parts = ["curl", "-X", req.method];
  for (const [key, value] of Object.entries(req.headers)) {
    parts.push("-H", shellQuote(`${key}: ${value}`));
  }
  if (req.body !== undefined && req.method !== "GET" && req.method !== "HEAD") {
    parts.push("-d", shellQuote(req.body));
  }
  parts.push(shellQuote(req.url));
  return parts.join(" ");
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:?&=-]+$/.test(s)) {
    return s;
  }
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function fromCurl(curl: string): Partial<OutboundRequest> & { method?: HttpMethod } {
  const methodMatch = curl.match(/-X\s+(\w+)/i);
  const method = (methodMatch?.[1]?.toUpperCase() ?? "GET") as HttpMethod;
  const urlMatch = curl.match(/curl\s+(?:[^'"]\s+)*['"]([^'"]+)['"]/i) ?? curl.match(/\s(https?:\/\/[^\s'"]+)/);
  const url = urlMatch?.[1] ?? "";
  const headers: Record<string, string> = {};
  for (const m of curl.matchAll(/-H\s+['"]([^'"]+)['"]/gi)) {
    const idx = m[1]!.indexOf(":");
    if (idx > 0) {
      headers[m[1]!.slice(0, idx).trim()] = m[1]!.slice(idx + 1).trim();
    }
  }
  const bodyMatch = curl.match(/-d\s+['"]([^'"]*)['"]/s);
  return { method, url, headers, body: bodyMatch?.[1] };
}
