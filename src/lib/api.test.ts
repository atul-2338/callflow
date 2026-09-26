import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveClientSettings, getAuthToken, setAuthToken } from "./api";

describe("saveClientSettings", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
          removeItem: (key: string) => storage.delete(key),
        },
      },
      configurable: true,
      writable: true,
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true } as Response)));
  });

  it("stores the auth token and posts the FCM token to the settings API", async () => {
    await saveClientSettings({ authToken: "demo-token", fcmToken: "device-token-123" });

    expect(getAuthToken()).toBe("demo-token");
    expect(globalThis.window.localStorage.getItem("callflow_fcm_token")).toBe("device-token-123");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer demo-token",
        }),
        body: JSON.stringify({
          missedCallReplyTemplate: "Sorry we missed your call! We'll get back to you shortly.",
          fcmToken: "device-token-123",
        }),
      })
    );
  });

  it("clears the auth token when empty is saved", () => {
    setAuthToken("prior-token");
    setAuthToken("");

    expect(getAuthToken()).toBe("");
  });
});
