import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/setup/config serves the CallFlow forwarding DID to the onboarding
// wizard: the signed-in owner's admin-assigned number
// (businesses.assignedNumber) first, then the shared CALLFLOW_FORWARDING_DID
// env. The handler reads the env at request time, so each test sets/restores
// it around the call. Fail closed: unset or invalid values answer 503 and log
// loudly, because a wrong number must never render as carrier dial codes.
// business-session and db are mocked so the suite stays DB-free and needs no
// real session secret.

const businessIdFromCookieHeaderMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/business-session", () => ({
  businessIdFromCookieHeader: businessIdFromCookieHeaderMock,
}));

const getBusinessByIdMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getBusinessById: getBusinessByIdMock }));

const DID_ENV = "CALLFLOW_FORWARDING_DID";
const originalDid = process.env[DID_ENV];

function restoreDid() {
  if (originalDid === undefined) delete process.env[DID_ENV];
  else process.env[DID_ENV] = originalDid;
}

async function getResponse(cookie?: string): Promise<Response> {
  const { GET } = await import("@/app/api/setup/config/route");
  return GET(
    new Request("http://localhost:3000/api/setup/config", {
      headers: cookie ? { cookie } : {},
    })
  );
}

describe("GET /api/setup/config", () => {
  beforeEach(() => {
    businessIdFromCookieHeaderMock.mockReset().mockReturnValue(null);
    getBusinessByIdMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreDid();
  });

  it("serves the configured forwarding DID as E.164", async () => {
    process.env[DID_ENV] = "+19283319394";
    const response = await getResponse();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ forwardingDid: "+19283319394" });
  });

  it("normalizes formatted values but keeps the leading +", async () => {
    process.env[DID_ENV] = "+1 928 331-9394";
    const response = await getResponse();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ forwardingDid: "+19283319394" });
  });

  it("answers 503 and logs loudly when the variable is unset", async () => {
    delete process.env[DID_ENV];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await getResponse();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Forwarding configuration missing",
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
      "CALLFLOW_FORWARDING_DID"
    );
  });

  it("answers 503 when the value is missing the leading +", async () => {
    process.env[DID_ENV] = "9283319394";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await getResponse();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Forwarding configuration missing",
    });
  });

  it("answers 503 when the value is not a real phone number", async () => {
    process.env[DID_ENV] = "+12345";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await getResponse();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Forwarding configuration missing",
    });
  });

  it("serves the signed-in owner's assigned number over the shared DID", async () => {
    process.env[DID_ENV] = "+19283319394";
    businessIdFromCookieHeaderMock.mockReturnValue("biz-1");
    getBusinessByIdMock.mockResolvedValue({
      id: "biz-1",
      assignedNumber: "+12125550123",
    });
    const response = await getResponse("callflow_business_session=fake-token");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ forwardingDid: "+12125550123" });
    expect(getBusinessByIdMock).toHaveBeenCalledWith("biz-1");
  });

  it("falls back to the shared DID when the business has no assigned number", async () => {
    process.env[DID_ENV] = "+19283319394";
    businessIdFromCookieHeaderMock.mockReturnValue("biz-1");
    getBusinessByIdMock.mockResolvedValue({ id: "biz-1", assignedNumber: null });
    const response = await getResponse("callflow_business_session=fake-token");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ forwardingDid: "+19283319394" });
  });

  it("falls back to the shared DID when the assigned number lacks the leading +", async () => {
    process.env[DID_ENV] = "+19283319394";
    businessIdFromCookieHeaderMock.mockReturnValue("biz-1");
    getBusinessByIdMock.mockResolvedValue({
      id: "biz-1",
      assignedNumber: "12125550123",
    });
    const response = await getResponse("callflow_business_session=fake-token");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ forwardingDid: "+19283319394" });
  });
});