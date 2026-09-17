import { describe, expect, it } from "vitest";
import { isDeadFcmTokenError } from "./firebase";

describe("isDeadFcmTokenError", () => {
  it("recognizes FCM HTTP v1 and legacy unregistered-token codes", () => {
    for (const code of [
      "messaging/unregistered",
      "messaging/registration-token-not-registered",
      "messaging/invalid-registration-token",
    ]) {
      expect(isDeadFcmTokenError({ code })).toBe(true);
    }
  });

  it("treats every other failure as transient", () => {
    expect(isDeadFcmTokenError({ code: "messaging/third-party-auth-error" })).toBe(false);
    expect(isDeadFcmTokenError({ code: "messaging/api-key-not-valid" })).toBe(false);
    expect(isDeadFcmTokenError(new Error("network"))).toBe(false);
    expect(isDeadFcmTokenError(null)).toBe(false);
    expect(isDeadFcmTokenError(undefined)).toBe(false);
  });
});