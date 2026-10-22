import type { Call } from "./types";

const TOKEN_KEY = "callflow_auth_token";
const FCM_TOKEN_KEY = "callflow_fcm_token";
const DEFAULT_REPLY_TEMPLATE = "Sorry we missed your call! We'll get back to you shortly.";

export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) || "";
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  if (!token) {
    window.localStorage.removeItem(TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function getFcmToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(FCM_TOKEN_KEY) || "";
}

export function setFcmToken(token: string): void {
  if (typeof window === "undefined") return;
  if (!token) {
    window.localStorage.removeItem(FCM_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(FCM_TOKEN_KEY, token);
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function apiFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

/**
 * Owner follow-up workflow on a call (dashboard + call-log pages). Throws on
 * any non-OK response so the UI can surface the error honestly instead of
 * pretending the follow-up was saved.
 */
export async function updateCallFollowUp(
  callId: string,
  update: { followUpStatus?: "none" | "needed" | "resolved"; followUpNotes?: string }
): Promise<Call> {
  const response = await apiFetch(`/api/calls/${encodeURIComponent(callId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!response.ok) {
    throw new Error(`Could not save follow-up (error ${response.status})`);
  }
  return (await response.json()) as Call;
}

export async function saveClientSettings({
  authToken,
  fcmToken,
  notificationEmail,
  address,
}: {
  authToken?: string;
  fcmToken?: string;
  /** Owner alert email — persisted onto the signed-in business record. */
  notificationEmail?: string;
  /** Business address — persisted onto the signed-in business record. */
  address?: string;
}): Promise<void> {
  if (authToken !== undefined) setAuthToken(authToken);

  const tokenToSave = (fcmToken ?? getFcmToken()).trim();
  if (tokenToSave) setFcmToken(tokenToSave);
  else setFcmToken("");

  const response = await fetch("/api/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      missedCallReplyTemplate: DEFAULT_REPLY_TEMPLATE,
      fcmToken: tokenToSave,
      // Only included when the caller manages it, so legacy callers keep the
      // exact same request body as before.
      ...(notificationEmail !== undefined ? { notificationEmail } : {}),
      ...(address !== undefined ? { address } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save client settings: ${response.status}`);
  }
}
