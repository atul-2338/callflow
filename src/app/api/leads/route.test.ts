import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "@/lib/database";
import { resetRateLimits } from "@/lib/rate-limit";
import { leadsNotifyAddress, POST } from "./route";

// The route alerts the operator over SMTP; swap the transport out so the suite
// never opens a socket (the real sendOperatorAlertEmail is already covered by
// src/lib/email.test.ts).
const emailMocks = vi.hoisted(() => ({ operatorAlert: vi.fn() }));

vi.mock("@/lib/email", () => ({
  readSmtpConfig: () => ({
    host: "smtp.test",
    port: 587,
    user: null,
    pass: null,
    from: "CallFlow <ops@callflow.test>",
  }),
  sendOperatorAlertEmail: emailMocks.operatorAlert,
  smtpConfigError: () => null,
}));

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-leads-route-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

function leadRequest(body: unknown, bodyText?: string, ip = "203.0.113.5"): Request {
  return new Request("http://localhost:3000/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: bodyText ?? JSON.stringify(body),
  });
}

const VALID = { name: "Dana Reed", phone: "(928) 331-9394", email: "Dana@Example.com" };

describe("POST /api/leads", () => {
  beforeEach(() => {
    resetRateLimits();
    // Pin the two env values the recipient lookup reads, so a real .env.local
    // can never change what these assertions see.
    vi.stubEnv("SMTP_FROM", "CallFlow <ops@callflow.test>");
    vi.stubEnv("LEADS_NOTIFY_EMAIL", "");
    emailMocks.operatorAlert.mockReset();
    emailMocks.operatorAlert.mockResolvedValue({ sent: true, messageId: "<lead-1@test.local>" });
  });

  afterEach(() => {
    resetRateLimits();
    getDb().prepare("DELETE FROM leads").run();
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
  });

  it("saves a valid submission as a new lead and emails the operator", async () => {
    const response = await POST(leadRequest(VALID));
    expect(response.status).toBe(201);

    const body = (await response.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);

    const row = getDb()
      .prepare("SELECT * FROM leads WHERE id = ?")
      .get(body.id) as { name: string; phone: string; email: string; status: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("Dana Reed");
    // Normalized exactly like every other owner-entered number.
    expect(row!.phone).toBe("+19283319394");
    expect(row!.email).toBe("dana@example.com");
    expect(row!.status).toBe("new");

    expect(emailMocks.operatorAlert).toHaveBeenCalledTimes(1);
    const [config, to, subject, text] = emailMocks.operatorAlert.mock.calls[0];
    expect(config.from).toBe("CallFlow <ops@callflow.test>");
    // No LEADS_NOTIFY_EMAIL in this run → the From address is the fallback.
    expect(to).toBe("CallFlow <ops@callflow.test>");
    expect(subject).toContain("Dana Reed");
    expect(text).toContain("+19283319394");
  });

  it("prefers LEADS_NOTIFY_EMAIL over SMTP_FROM", async () => {
    vi.stubEnv("LEADS_NOTIFY_EMAIL", "leads@callflow.biz");
    vi.stubEnv("SMTP_FROM", "CallFlow <ops@callflow.test>");
    expect(leadsNotifyAddress()).toBe("leads@callflow.biz");

    const response = await POST(leadRequest(VALID));
    expect(response.status).toBe(201);
    expect(emailMocks.operatorAlert.mock.calls[0][1]).toBe("leads@callflow.biz");
  });

  it("still saves the lead when the alert cannot be sent", async () => {
    emailMocks.operatorAlert.mockResolvedValueOnce({ sent: false, error: "Connection timeout" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(leadRequest(VALID));
    expect(response.status).toBe(201);

    const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number };
    expect(n).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects an empty name, an unparseable phone and a bad email", async () => {
    const shortName = await POST(leadRequest({ ...VALID, name: "D" }));
    expect(shortName.status).toBe(400);
    expect((await shortName.json()) as { error: string }).toEqual({ error: "Enter your name." });

    const badPhone = await POST(leadRequest({ ...VALID, phone: "123" }));
    expect(badPhone.status).toBe(400);
    expect(((await badPhone.json()) as { error: string }).error).toMatch(/valid phone number/i);

    const badEmail = await POST(leadRequest({ ...VALID, email: "not-an-email" }));
    expect(badEmail.status).toBe(400);
    expect(((await badEmail.json()) as { error: string }).error).toMatch(/valid email/i);

    const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number };
    expect(n).toBe(0);
    expect(emailMocks.operatorAlert).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const response = await POST(leadRequest({}, "{not-json"));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/valid JSON/i);
  });

  it("rate-limits the 6th submission in the window from one IP", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await POST(leadRequest(VALID))).status).toBe(201);
    }
    const blocked = await POST(leadRequest(VALID));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
    // A different visitor is unaffected.
    expect((await POST(leadRequest(VALID, undefined, "203.0.113.6"))).status).toBe(201);
  });
});
