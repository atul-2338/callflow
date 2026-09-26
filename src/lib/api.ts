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

export async function saveClientSettings({
  authToken,
  fcmToken,
}: {
  authToken?: string;
  fcmToken?: string;
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
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save client settings: ${response.status}`);
  }
}
