import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

// Point the app database at a throwaway file *before* `./database` opens it.
const testDbPath = path.join(os.tmpdir(), `callflow-leads-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDbPath;

const { createLead, getLeadById, setLeadStatus } = await import("./db");
const { adminListLeads } = await import("./admin-db");

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${testDbPath}${suffix}`, { force: true });
    } catch {
      // Windows keeps the file locked while the connection is open.
    }
  }
}

afterAll(cleanup);

describe("leads", () => {
  it("stores a new lead as 'new' with a normalized name and email", async () => {
    const lead = await createLead({
      name: "  Dana Reed ",
      phone: "+15550001111",
      email: "Dana@Example.COM",
    });

    expect(lead.name).toBe("Dana Reed");
    expect(lead.email).toBe("dana@example.com");
    expect(lead.phone).toBe("+15550001111");
    expect(lead.status).toBe("new");
    expect(lead.updatedAt).toBe(lead.createdAt);
    expect(await getLeadById(lead.id)).toEqual(lead);
  });

  it("lists every lead, newest first", async () => {
    const older = await createLead({
      name: "Older Lead",
      phone: "+15550002222",
      email: "older@example.com",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createLead({
      name: "Newer Lead",
      phone: "+15550003333",
      email: "newer@example.com",
    });

    const leads = await adminListLeads();
    const ids = leads.map((lead) => lead.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    expect(leads.length).toBeGreaterThanOrEqual(2);
  });

  it("moves a lead's status and stamps updatedAt", async () => {
    const lead = await createLead({
      name: "Status Lead",
      phone: "+15550004444",
      email: "status@example.com",
    });

    const updated = await setLeadStatus(lead.id, "contacted");
    expect(updated?.status).toBe("contacted");
    expect(updated?.updatedAt).not.toBe(lead.updatedAt);

    // Every status in the shared enum is storable.
    for (const status of ["account_created", "dead", "new"] as const) {
      expect((await setLeadStatus(lead.id, status))?.status).toBe(status);
    }
  });

  it("returns null for an unknown lead id", async () => {
    expect(await setLeadStatus("lead-that-does-not-exist", "dead")).toBeNull();
    expect(await getLeadById("lead-that-does-not-exist")).toBeNull();
  });
});
