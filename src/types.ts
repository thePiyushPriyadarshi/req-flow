export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: {
    type: "none" | "json" | "form" | "text";
    content: string;
    form: KeyValue[];
  };
  auth: {
    type: "none" | "bearer" | "basic";
    token?: string;
    username?: string;
    password?: string;
  };
}

export interface Environment {
  name: string;
  variables: Record<string, string>;
  defaultHeaders?: KeyValue[];
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  request: ApiRequest;
  /** Response snapshot when the call succeeded */
  response?: ApiResponse;
  /** Error snapshot when the call failed */
  error?: ApiError;
  status?: number;
  timeMs?: number;
  /** Active environment name at send time */
  environment?: string;
}

export type CollectionNodeType = "collection" | "folder" | "request";

export interface CollectionTreeNode {
  id: string;
  name: string;
  type: CollectionNodeType;
  children?: CollectionTreeNode[];
  request?: ApiRequest;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
  sizeBytes: number;
}

export interface ApiError {
  message: string;
  code?: string;
}

export type OutboundRequest = {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "newRequest" }
  | { type: "send"; request: ApiRequest }
  | { type: "saveRequest"; request: ApiRequest }
  | { type: "saveDraft"; request: Partial<ApiRequest> }
  | { type: "cancel" }
  | { type: "persistSplit"; splitPercent: number }
  | { type: "copyResponse"; text: string };

export type HostToWebviewMessage =
  | {
      type: "init";
      request: ApiRequest;
      theme: "light" | "dark" | "hc";
      environments: Environment[];
      activeEnvironment: string;
      variableKeys: string[];
      splitPercent: number;
      isPreview?: boolean;
      restoredResponse?: ApiResponse | null;
      restoredError?: ApiError | null;
    }
  | { type: "response"; data: ApiResponse }
  | { type: "error"; error: ApiError }
  | { type: "sending" }
  | { type: "idle" }
  | { type: "saved"; request: ApiRequest }
  | { type: "envChanged"; activeEnvironment: string; variableKeys: string[] }
  | { type: "focusUrl" }
  | { type: "triggerSave" }
  | { type: "triggerSend" }
  | { type: "autoSaving" }
  | { type: "autoSaved" };
