import type { ApiError, ApiResponse, OutboundRequest } from "../types";

const DEFAULT_TIMEOUT_MS = 30_000;

export async function sendRequest(
  req: OutboundRequest,
  signal?: AbortSignal
): Promise<ApiResponse> {
  const start = performance.now();
  const url = req.url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw clientError("Invalid URL. Include a scheme such as https://");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const init: RequestInit = {
      method: req.method,
      headers: req.headers,
      signal: controller.signal,
      redirect: "follow",
    };

    if (req.body !== undefined && req.method !== "GET" && req.method !== "HEAD") {
      init.body = req.body;
    }

    const response = await fetch(parsed.toString(), init);
    const buffer = Buffer.from(await response.arrayBuffer());
    const timeMs = Math.round(performance.now() - start);

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: buffer.toString("utf8"),
      timeMs,
      sizeBytes: buffer.byteLength,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw clientError(
        signal?.aborted ? "Request cancelled" : "Request timed out after 30s"
      );
    }
    const message =
      err instanceof Error ? err.message : "Network request failed";
    throw clientError(friendlyNetworkMessage(message));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function clientError(message: string): ApiError {
  return { message };
}

function friendlyNetworkMessage(raw: string): string {
  if (/ENOTFOUND|getaddrinfo/i.test(raw)) {
    return "Could not resolve host. Check the URL.";
  }
  if (/ECONNREFUSED/i.test(raw)) {
    return "Connection refused. Is the server running?";
  }
  if (/certificate|SSL|TLS/i.test(raw)) {
    return "TLS error. Check HTTPS certificates.";
  }
  return raw;
}
