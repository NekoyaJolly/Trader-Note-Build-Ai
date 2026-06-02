import { getPublicApiBaseUrl } from "./publicApiBaseUrl";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ApiClientErrorKind =
  | "auth"
  | "forbidden"
  | "locked"
  | "network"
  | "http"
  | "parse";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly kind: ApiClientErrorKind,
    public readonly status: number,
    public readonly endpoint: string,
    public readonly payload: JsonValue | null = null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const AUTH_TOKEN_KEY = "auth_token";

function getStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function resolveUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input !== "string") return input;
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  return `${getPublicApiBaseUrl()}${input.startsWith("/") ? input : `/${input}`}`;
}

function isFormDataBody(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  const token = getStoredAuthToken();

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (init?.body && !isFormDataBody(init.body) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readMessage(payload: JsonValue | null, fallback: string): string {
  if (!payload || !isJsonObject(payload)) return fallback;

  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;

  const message = payload.message;
  if (typeof message === "string" && message.trim()) return message;

  return fallback;
}

function classifyStatus(status: number): ApiClientErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 423) return "locked";
  return "http";
}

async function parseJsonResponse(response: Response, endpoint: string): Promise<JsonValue | null> {
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    if (response.ok) {
      throw new ApiClientError(
        "レスポンスJSONの解析に失敗しました",
        "parse",
        response.status,
        endpoint,
      );
    }
    return null;
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(resolveUrl(input), {
    ...init,
    credentials: init?.credentials ?? "include",
    headers: buildHeaders(init),
  });
}

export async function apiRequest<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const endpoint = typeof input === "string" ? input : input.toString();
  let response: Response;

  try {
    response = await apiFetch(input, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ネットワークエラーが発生しました";
    throw new ApiClientError(`ネットワークエラー: ${message}`, "network", 0, endpoint);
  }

  const payload = await parseJsonResponse(response, endpoint);
  if (!response.ok) {
    const fallback = `${response.status} ${response.statusText}`;
    throw new ApiClientError(
      readMessage(payload, fallback),
      classifyStatus(response.status),
      response.status,
      endpoint,
      payload,
    );
  }

  if (payload && isJsonObject(payload) && payload.success === false) {
    throw new ApiClientError(
      readMessage(payload, "API がエラーを返しました"),
      "http",
      response.status,
      endpoint,
      payload,
    );
  }

  return payload as T;
}
