import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCallAlertEmail,
  callAlertSubject,
  formatCallTime,
  readSmtpConfig,
  sendCallAlertEmail,
  smtpConfigError,
  telHref,
  type CallAlertEmailInput,
} from "./email";

const { createTransport, sendMail, close } = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

beforeEach(() => {
  createTransport.mockReset();
  sendMail.mockReset();
  close.mockReset();
  createTransport.mockReturnValue({ sendMail, close });
});

const FULL_SMTP_ENV = {
  SMTP_HOST: '"smtp.test.local"',
  SMTP_PORT: "587",
  SMTP_USER: "alerts@test.local",
  SMTP_PASS: "secret-pass",
  SMTP_FROM: '"Callflow <alerts@test.local>"',
};

const BASE_INPUT: CallAlertEmailInput = {
  name: "",
  urgency: null,
  reason: null,
  callbackNumber: null,
  startedAt: "2026-10-07T06:35:12.000Z",
  recordingUrl: null,
  dashboardUrl: "http://localhost:3000/calls",
};

describe("SMTP configuration", () => {
  it("names every missing variable in one plain-English reason", () => {
    expect(smtpConfigError({})).toContain(
      "SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM"
    );
  });

  it("accepts a fully configured environment and strips quotes", () => {
    expect(smtpConfigError(FULL_SMTP_ENV)).toBeNull();
    expect(readSmtpConfig(FULL_SMTP_ENV)).toEqual({
      host: "smtp.test.local",
      port: 587,
      user: "alerts@test.local",
      pass: "secret-pass",
      from: "Callflow <alerts@test.local>",
    });
  });

  it("rejects a port that is not a number", () => {
    const env = { ...FULL_SMTP_ENV, SMTP_PORT: "abc" };
    expect(smtpConfigError(env)).toContain("SMTP_PORT");
    expect(readSmtpConfig(env)).toBeNull();
  });
});

describe("callAlertSubject", () => {
  it("uses the EMERGENCY subject for emergency urgency", () => {
    expect(
      callAlertSubject({ ...BASE_INPUT, name: "Dana Reed", urgency: "emergency" })
    ).toBe("EMERGENCY call from Dana Reed");
  });

  it('falls back to "Unknown caller" and includes the urgency label otherwise', () => {
    expect(callAlertSubject({ ...BASE_INPUT, urgency: "today" })).toBe(
      "New call from Unknown caller (today)"
    );
  });
});

// more describes below

describe("telHref and formatCallTime", () => {
  it("builds a tel: link from a formatted number and stays empty without one", () => {
    expect(telHref("+1 (555) 010-2030")).toBe("tel:+15550102030");
    expect(telHref(null)).toBe("");
    expect(telHref("")).toBe("");
  });

  it("formats the call time as UTC and keeps unparseable input as-is", () => {
    expect(formatCallTime("2026-10-07T06:35:12.000Z")).toBe("2026-10-07 06:35 UTC");
    expect(formatCallTime("not-a-date")).toBe("not-a-date");
  });
});

describe("buildCallAlertEmail", () => {
  it("includes reason, tap-to-call link, time, recording and dashboard", () => {
    const email = buildCallAlertEmail({
      ...BASE_INPUT,
      name: "Dana Reed",
      urgency: "today",
      reason: "Cracked floor tiles",
      callbackNumber: "+1 (555) 010-2030",
      recordingUrl: "https://app.dograh.com/public/download/workflow/r1/recording",
    });
    expect(email.subject).toBe("New call from Dana Reed (today)");
    expect(email.text).toContain("What they need: Cracked floor tiles");
    expect(email.text).toContain("Call them back: +1 (555) 010-2030");
    expect(email.text).toContain("Call time: 2026-10-07 06:35 UTC");
    expect(email.text).toContain("Listen to the recording:");
    expect(email.text).toContain("Open the dashboard: http://localhost:3000/calls");
    expect(email.html).toContain('href="tel:+15550102030"');
    expect(email.html).toContain(
      'href="https://app.dograh.com/public/download/workflow/r1/recording"'
    );
  });

  it("is honest about fields the agent never captured", () => {
    const email = buildCallAlertEmail(BASE_INPUT);
    expect(email.subject).toBe("New call from Unknown caller (New)");
    expect(email.text).toContain("What they need: (not captured)");
    expect(email.text).not.toContain("Listen to the recording");
    expect(email.html).not.toContain("Listen to the recording");
    expect(email.html).not.toContain('href="tel:');
  });
});

describe("sendCallAlertEmail", () => {
  it("sends via SMTP and reports the message id", async () => {
    sendMail.mockResolvedValueOnce({ messageId: "<mid-1@test.local>" });
    const result = await sendCallAlertEmail(
      { host: "smtp.test.local", port: 587, user: "u", pass: "p", from: "Callflow <a@t.local>" },
      "owner@example.com",
      { ...BASE_INPUT, name: "Dana Reed" }
    );
    expect(result).toEqual({ sent: true, messageId: "<mid-1@test.local>" });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.test.local",
        port: 587,
        secure: false,
        auth: { user: "u", pass: "p" },
      })
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Callflow <a@t.local>",
        to: "owner@example.com",
        subject: "New call from Dana Reed (New)",
      })
    );
    expect(close).toHaveBeenCalled();
  });

  it("uses a secure connection on port 465", async () => {
    sendMail.mockResolvedValueOnce({ messageId: "<mid-2@test.local>" });
    await sendCallAlertEmail(
      { host: "smtp.test.local", port: 465, user: "u", pass: "p", from: "a@t.local" },
      "owner@example.com",
      BASE_INPUT
    );
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true })
    );
  });

  it("returns the SMTP error instead of throwing, so the webhook can 200", async () => {
    sendMail.mockRejectedValueOnce(new Error("Invalid login: 535"));
    const result = await sendCallAlertEmail(
      { host: "smtp.test.local", port: 587, user: "u", pass: "p", from: "a@t.local" },
      "owner@example.com",
      BASE_INPUT
    );
    expect(result).toEqual({ sent: false, error: "Invalid login: 535" });
    expect(close).toHaveBeenCalled();
  });
});