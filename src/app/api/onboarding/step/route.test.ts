import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/database";
import { createBusiness, getBusinessById, updateBusiness } from "@/lib/db";
import { businessSessionCookieName, createBusinessSessionToken } from "@/lib/business-session";
import { POST } from "./route";

const TEST_SECRET = "onboarding-step-test-secret";
// Throwaway database AND throwaway number pool: this suite assigns real pool
// numbers, so both files must live in the temp directory.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-onboarding-step-${process.pid}-${Date.now()}.db`
);
const TEST_POOL_PATH = path.join(
  os.tmpdir(),
  `callflow-onboarding-step-pool-${process.pid}-${Date.now()}.json`
);
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.NUMBERS_POOL_PATH = TEST_POOL_PATH;

type NewBusiness = Parameters<typeof createBusiness>[0];

let phoneSeq = 0;

function seedBusiness(overrides: Partial<NewBusiness> = {}): NewBusiness {
  phoneSeq += 1;
  return {
    phoneNumber: `+1312555${String(1000 + phoneSeq)}`,
    carrier: "other",
    forwardingStatus: "not_started",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
    billingName: `Step Biz ${phoneSeq}`,
    billingEmail: `owner${phoneSeq}@step.test`,
    billingCountry: "US",
    trialStartedAt: null,
    subscriptionStatus: "active",
    ...overrides,
  };
}

/** A business parked on step 2 of the linear onboarding flow. */
async function makeStepTwoBusiness(overrides: Partial<NewBusiness> = {}) {
  const business = await createBusiness(seedBusiness(overrides));
  const updated = await updateBusiness(business.id, { onboardingStep: "2" });
  return updated ?? business;
}

function writePool(numbers: string[]) {
  fs.writeFileSync(
    TEST_POOL_PATH,
    JSON.stringify(
      numbers.map((number) => ({
        number,
        status: "available",
        businessId: null,
        assignedAt: null,
      }))
    )
  );
}

function stepRequest(businessId: string | null, step = "3"): Request {
  return new Request("http://localhost:3000/api/onboarding/step", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(businessId
        ? { cookie: `${businessSessionCookieName()}=${createBusinessSessionToken(businessId)}` }
        : {}),
    },
    body: JSON.stringify({ step }),
  });
}

describe("POST /api/onboarding/step — the last chance to get a number", () => {
  beforeEach(() => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    fs.rmSync(TEST_POOL_PATH, { force: true });
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
    fs.rmSync(TEST_POOL_PATH, { force: true });
  });

  it("assigns a number on the way to the forwarding step", async () => {
    writePool(["+15550107777"]);
    const business = await makeStepTwoBusiness();

    const response = await POST(stepRequest(business.id));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.onboardingStep).toBe("3");
    expect(body.assignedNumber).toBe("+15550107777");
    expect((await getBusinessById(business.id))?.assignedNumber).toBe("+15550107777");
  });

  it("keeps the owner on step 2 with a pending answer when the pool is empty", async () => {
    // No pool file at all: the "your number is being prepared" case, never an
    // error page.
    const business = await makeStepTwoBusiness();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(stepRequest(business.id));
    const body = (await response.json()) as Record<string, unknown>;
    errorSpy.mockRestore();

    expect(response.status).toBe(200);
    expect(body.onboardingStep).toBe("2");
    expect(body.pending).toBe(true);
    expect(body.assignedNumber).toBeNull();
    expect(body.error).toBeUndefined();
    expect((await getBusinessById(business.id))?.assignedNumber).toBeNull();
  });

  it("never re-assigns a business that already has its number", async () => {
    writePool(["+15550107778"]);
    const business = await makeStepTwoBusiness({ assignedNumber: "+15550100001" });

    const response = await POST(stepRequest(business.id));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.onboardingStep).toBe("3");
    expect((await getBusinessById(business.id))?.assignedNumber).toBe("+15550100001");
    // The free pool number was left alone for the next signup.
    expect(fs.readFileSync(TEST_POOL_PATH, "utf8")).toContain("\"available\"");
  });

  it("still refuses an unauthorised caller", async () => {
    const response = await POST(stepRequest(null));
    expect(response.status).toBe(401);
  });
});
