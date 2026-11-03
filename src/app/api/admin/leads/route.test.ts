import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_SESSION_COOKIE_NAME, createAdminSessionToken } from "@/lib/admin-session";
import { businessSessionCookieName, createBusinessSessionToken } from "@/lib/business-session";
import { closeDb, getDb } from "@/lib/database";
import { createLead } from "@/lib/db";

import { GET } from "./route";
import { PATCH } from "./[id]/route";

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-admin-leads-route-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

const ADMIN_SECRET = "admin-leads-route-test-secret";
const OWNER_SECRET = "admin-leads-owner-secret";

/**
 * The REAL guards run here (nothing is mocked): only the admin cookie may read
 * or move a lead, and an owner's valid callflow_business_session is not it.
 */
function adminCookie(): string {
  return `${ADMIN_SESSION_COOKIE_NAME}=${createAdminSessionToken({ secret: ADMIN_SECRET })}`;
}

function ownerCookie(): string {
  return `${businessSessionCookieName()}=${createBusinessSessionToken("biz-owner-1")}`;
}

function getRequest(cookie?: string): Request {
  return new Request("http://localhost:3000/api/admin/leads", {
    method: "GET",
    headers: cookie ? { cookie } : {},
  });
}

function patchContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function seedLead() {
  return createLead({
    name: "Dana Reed",
    phone: "+19283319394",
    email: "dana@example.com",
  });
}

describe("admin leads API", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "scrypt$16384$8$1$00$00");
    vi.stubEnv("ADMIN_SESSION_SECRET", ADMIN_SECRET);
    vi.stubEnv("BUSINESS_SESSION_SECRET", OWNER_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    getDb().prepare("DELETE FROM leads").run();
    getDb().prepare("DELETE FROM admin_audit_log").run();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
  });

  it("GET 401s without an admin session, including for a valid owner session", async () => {
    expect((await GET(getRequest())).status).toBe(401);
    expect((await GET(getRequest(ownerCookie()))).status).toBe(401);
  });

  it("GET lists every lead, newest first", async () => {
    const lead = await seedLead();

    const response = await GET(getRequest(adminCookie()));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { leads: Array<{ id: string; status: string }> };
    expect(body.leads).toHaveLength(1);
    expect(body.leads[0].id).toBe(lead.id);
    expect(body.leads[0].status).toBe("new");
  });

  it("PATCH 401s without an admin session", async () => {
    const lead = await seedLead();
    const request = new Request(`http://localhost:3000/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "contacted" }),
    });

    expect((await PATCH(request, patchContext(lead.id))).status).toBe(401);
    // Nothing was written by the refused request.
    const row = getDb().prepare("SELECT status FROM leads WHERE id = ?").get(lead.id) as {
      status: string;
    };
    expect(row.status).toBe("new");
  });

  it("PATCH rejects a status outside the shared enum", async () => {
    const lead = await seedLead();
    const request = new Request(`http://localhost:3000/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie() },
      body: JSON.stringify({ status: "sold" }),
    });

    const response = await PATCH(request, patchContext(lead.id));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/new, contacted/);
  });

  it("PATCH 404s for an unknown lead id", async () => {
    const request = new Request("http://localhost:3000/api/admin/leads/lead-nope", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie() },
      body: JSON.stringify({ status: "dead" }),
    });

    const response = await PATCH(request, patchContext("lead-nope"));
    expect(response.status).toBe(404);
  });

  it("PATCH moves the lead and records one audit row", async () => {
    const lead = await seedLead();
    const request = new Request(`http://localhost:3000/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie() },
      body: JSON.stringify({ status: "account_created" }),
    });

    const response = await PATCH(request, patchContext(lead.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { lead: { status: string } };
    expect(body.lead.status).toBe("account_created");

    const audit = getDb()
      .prepare("SELECT action, target FROM admin_audit_log ORDER BY createdAt DESC LIMIT 1")
      .get() as { action: string; target: string } | undefined;
    expect(audit).toEqual({ action: "lead_status_updated", target: lead.id });
  });
});
