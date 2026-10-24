import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "./database";
import { createBusiness, getBusinessById, getBusinessByName, getBusinessByPhone } from "./db";
import {
  BUSINESS_NAME_TAKEN_ERROR,
  BusinessNameTakenError,
  createBillingSignup,
} from "./billing";

/**
 * Business-name uniqueness + permanent client UID, against a real temp SQLite
 * database. createBillingSignup is exercised only up to the name check: with
 * no Dodo credentials in the environment it fails right AFTER the check,
 * which is exactly what lets us prove the check runs before any Dodo call.
 */

let tmpDir = "";

function businessRow(
  overrides: Partial<Parameters<typeof createBusiness>[0]> = {}
) {
  return {
    phoneNumber: "+18568243790",
    carrier: "other" as const,
    forwardingStatus: "not_started" as const,
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
    ...overrides,
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "callflow-bizname-"));
  process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
  delete process.env.APP_AUTH_TOKEN;
});

afterAll(() => {
  // Release the SQLite handle first: on Windows an open file (or its WAL
  // sidecars) makes rmSync fail with EPERM. The retry/warn fallback keeps a
  // temp-dir cleanup hiccup from ever failing the suite itself.
  closeDb();
  try {
    fs.rmSync(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch (err) {
    console.warn(`[business-name.test] could not remove temp dir ${tmpDir}: ${err}`);
  }
});

describe("createBusiness client UID", () => {
  it("assigns a unique, permanent TE- UID at creation", async () => {
    const a = await createBusiness(businessRow());
    expect(a.clientUid).toMatch(/^TE-[0-9a-f]{8}$/);

    const b = await createBusiness(
      businessRow({ phoneNumber: "+18568243791" })
    );
    expect(b.clientUid).toMatch(/^TE-[0-9a-f]{8}$/);
    expect(b.clientUid).not.toBe(a.clientUid);

    // The UID is persisted — a re-read returns the same value.
    const reread = await getBusinessById(a.id);
    expect(reread?.clientUid).toBe(a.clientUid);
  });
});

describe("getBusinessByName", () => {
  it("matches case-insensitively, ignoring surrounding whitespace", async () => {
    await createBusiness(
      businessRow({ phoneNumber: "+18568243792", billingName: "  Acme Plumbing  " })
    );
    expect((await getBusinessByName("ACME PLUMBING"))?.phoneNumber).toBe(
      "+18568243792"
    );
    expect((await getBusinessByName("  acme plumbing "))?.phoneNumber).toBe(
      "+18568243792"
    );
  });

  it("returns undefined for an unknown name", async () => {
    expect(await getBusinessByName("Zeppelin Repair Services")).toBeUndefined();
  });

  it("excludes the given business id (a business may re-use its own name)", async () => {
    const own = await getBusinessByName("ACME PLUMBING");
    expect(own).toBeDefined();
    expect(await getBusinessByName("ACME PLUMBING", own!.id)).toBeUndefined();
    // ...but a different business with the same name is still found.
    expect(
      (await getBusinessByName("ACME PLUMBING", "some-other-id"))?.phoneNumber
    ).toBe("+18568243792");
  });

  it("returns undefined for blank or whitespace-only input", async () => {
    expect(await getBusinessByName("")).toBeUndefined();
    expect(await getBusinessByName("   ")).toBeUndefined();
  });
});

describe("createBillingSignup duplicate-name guard", () => {
  it("throws BusinessNameTakenError before any Dodo call when the name is claimed", async () => {
    // "Acme Plumbing" belongs to +18568243792 (created above): a differently
    // cased / padded duplicate must be rejected before any Dodo call.
    await expect(
      createBillingSignup({
        phoneNumber: "+18568243793",
        name: "  ACME Plumbing  ",
        email: "owner@acme.test",
        country: "US",
      })
    ).rejects.toBeInstanceOf(BusinessNameTakenError);

    // The exact, frontend-facing message.
    await expect(
      createBillingSignup({
        phoneNumber: "+18568243793",
        name: "Acme Plumbing",
        email: "owner@acme.test",
        country: "US",
      })
    ).rejects.toThrow(BUSINESS_NAME_TAKEN_ERROR);

    // Nothing was created: the failed signup left no business row behind.
    expect(await getBusinessByPhone("+18568243793")).toBeUndefined();
  });

  it("lets a business re-signup under its own unchanged name", async () => {
    await createBusiness(
      businessRow({
        phoneNumber: "+18568243794",
        billingName: "Bobs Repair",
        billingEmail: "bobs@repair.test",
        billingCountry: "US",
      })
    );
    // Without Dodo credentials this rejects AFTER the name check — with a
    // Dodo/environment error, never with BusinessNameTakenError.
    await expect(
      createBillingSignup({
        phoneNumber: "+18568243794",
        name: " bobs repair ",
        email: "bobs@repair.test",
        country: "US",
      })
    ).rejects.not.toBeInstanceOf(BusinessNameTakenError);
  });
});