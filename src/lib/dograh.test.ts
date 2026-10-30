import { afterEach, describe, expect, it } from "vitest";
import {
  describeTopLevelKeys,
  parseDograhWebhookBody,
  readHeaderSafe,
  secretsMatch,
  webhookSecret,
} from "./dograh";

function headerMap(entries: Record<string, string>) {
  return {
    get: (name: string) => entries[name.toLowerCase()] ?? null,
  };
}

/** A header bag whose get() matches names EXACTLY (case-sensitive) — models
 * raw Node header records and naive mocks that skip Fetch's normalization. */
function strictHeaderMap(entries: Record<string, string>) {
  return {
    get: (name: string) =>
      Object.prototype.hasOwnProperty.call(entries, name) ? entries[name] : null,
  };
}

describe("readHeaderSafe — header-name casing", () => {
  it("finds lowercase and title-case spellings on a case-sensitive reader", () => {
    expect(
      readHeaderSafe(strictHeaderMap({ "X-Webhook-Secret": "s3cret" }), "x-webhook-secret")
    ).toBe("s3cret");
    expect(
      readHeaderSafe(strictHeaderMap({ "x-webhook-secret": "s3cret" }), "x-webhook-secret")
    ).toBe("s3cret");
    expect(readHeaderSafe(strictHeaderMap({}), "x-webhook-secret")).toBe("");
  });

  it("works with the real Fetch Headers class in any casing", () => {
    const headers = new Headers({ "X-Webhook-Secret": "s3cret" });
    expect(headers.get("x-webhook-secret")).toBe("s3cret"); // spec: name normalized
    expect(readHeaderSafe(headers, "x-webhook-secret")).toBe("s3cret");
  });

  it("collapses comma-joined duplicate values from Fetch Headers", () => {
    const headers = new Headers();
    headers.append("x-webhook-secret", "s3cret");
    headers.append("x-webhook-secret", "other");
    expect(headers.get("x-webhook-secret")).toBe("s3cret, other");
    expect(readHeaderSafe(headers, "x-webhook-secret")).toBe("s3cret");
  });

  it("tries names in order and survives a reader whose get() throws", () => {
    expect(
      readHeaderSafe(headerMap({ "x-fallback": "v" }), "x-missing", "x-fallback")
    ).toBe("v");
    const hostile = {
      get: () => {
        throw new Error("boom");
      },
    };
    expect(readHeaderSafe(hostile, "x-webhook-secret")).toBe("");
  });
});

describe("webhookSecret + secretsMatch", () => {
  const ORIGINAL = process.env.WEBHOOK_SECRET;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = ORIGINAL;
  });

  it("reads WEBHOOK_SECRET from the environment (unquoting)", () => {
    process.env.WEBHOOK_SECRET = '  "s3cret"  ';
    expect(webhookSecret()).toBe("s3cret");
    delete process.env.WEBHOOK_SECRET;
    expect(webhookSecret()).toBe("");
  });

  it("accepts the exact secret and rejects anything else, in constant time", () => {
    expect(secretsMatch("s3cret", "s3cret")).toBe(true);
    expect(secretsMatch("s3creT", "s3cret")).toBe(false); // case-sensitive
    expect(secretsMatch("", "s3cret")).toBe(false);
    expect(secretsMatch("s3cret", "")).toBe(false);
    expect(secretsMatch("a", "a much longer secret")).toBe(false); // safe across lengths
  });
});

describe("parseDograhWebhookBody — POST /api/webhooks/dograh contract", () => {
  it("parses callId, status, duration and gathered.context.customer_name", () => {
    const payload = parseDograhWebhookBody({
      callId: "c-1",
      status: "completed",
      duration: 184,
      gathered: { context: { customer_name: "Priya Raman" } },
      caller_number: "+15550000123",
      called_number: "+15550001111",
    });
    expect(payload).toEqual({
      callId: "c-1",
      status: "completed",
      durationSeconds: 184,
      customerName: "Priya Raman",
      callerNumber: "+15550000123",
      calledNumber: "+15550001111",
    });
  });

  it("accepts Dograh's stringified template values (nested dict as JSON string)", () => {
    const payload = parseDograhWebhookBody({
      callId: "700924",
      duration: "91",
      gathered: JSON.stringify({ context: { customer_name: "Jo Caller" } }),
      initial_context: JSON.stringify({
        caller_number: "+12137771234",
        called_number: "+12137771235",
      }),
    });
    expect(payload).toMatchObject({
      callId: "700924",
      durationSeconds: 91,
      customerName: "Jo Caller",
      callerNumber: "+12137771234",
      calledNumber: "+12137771235",
    });
    expect(payload!.status).toBe("");
  });

  it("accepts the previous template aliases (call_id / workflow_run_id / duration_seconds / gathered_context)", () => {
    const payload = parseDograhWebhookBody({
      workflow_run_id: "4217",
      duration_seconds: "184",
      gathered_context: JSON.stringify({ customer_name: "Jo" }),
      call_id: "4217b",
    });
    expect(payload).toMatchObject({
      callId: "4217b", // call_id ranks above workflow_run_id
      durationSeconds: 184,
      customerName: "Jo",
    });
  });

  it("reads customer_name from the documented gathered.context path first", () => {
    const payload = parseDograhWebhookBody({
      callId: "c-2",
      gathered: { context: { customer_name: "From Gathered" } },
      gathered_context: { customer_name: "From Legacy" },
      customer_name: "Flat",
    });
    expect(payload!.customerName).toBe("From Gathered");
  });

  it("returns null for non-object bodies and payloads without callId", () => {
    expect(parseDograhWebhookBody("not-an-object")).toBeNull();
    expect(parseDograhWebhookBody(null)).toBeNull();
    expect(parseDograhWebhookBody([1, 2])).toBeNull();
    expect(parseDograhWebhookBody({ junk: true })).toBeNull();
    expect(parseDograhWebhookBody({ callId: "   " })).toBeNull();
  });

  it("ignores extra fields", () => {
    const payload = parseDograhWebhookBody({
      callId: "c-3",
      status: "answered",
      unrelated: { deeply: ["nested", "junk"] },
      transcript_url: "https://example.com",
      cost_info: "123",
    });
    expect(payload).toEqual({
      callId: "c-3",
      status: "answered",
      durationSeconds: null,
      customerName: null,
      callerNumber: "",
      calledNumber: "",
    });
  });
});

describe("parseDograhWebhookBody — called-number aliases", () => {
  it("accepts to / to_number / called at the top level", () => {
    expect(parseDograhWebhookBody({ callId: "a", to: "+15550001111" })!.calledNumber).toBe(
      "+15550001111"
    );
    expect(parseDograhWebhookBody({ callId: "b", to_number: 15550002222 })!.calledNumber).toBe(
      "15550002222"
    );
    expect(parseDograhWebhookBody({ callId: "c", called: "+15550003333" })!.calledNumber).toBe(
      "+15550003333"
    );
  });

  it("accepts the same aliases inside initial_context (object or JSON string)", () => {
    expect(
      parseDograhWebhookBody({ callId: "a", initial_context: { to: "+15550001111" } })!
        .calledNumber
    ).toBe("+15550001111");
    expect(
      parseDograhWebhookBody({
        callId: "b",
        initial_context: JSON.stringify({ to_number: "+15550002222" }),
      })!.calledNumber
    ).toBe("+15550002222");
    expect(
      parseDograhWebhookBody({ callId: "c", initial_context: { called: " +15550003333 " } })!
        .calledNumber
    ).toBe("+15550003333");
  });

  it("accepts the aliases inside a nested call object (object or JSON string)", () => {
    expect(parseDograhWebhookBody({ callId: "a", call: { to: "+15550001111" } })!.calledNumber).toBe(
      "+15550001111"
    );
    expect(
      parseDograhWebhookBody({
        callId: "b",
        call: JSON.stringify({ called_number: "+15550002222" }),
      })!.calledNumber
    ).toBe("+15550002222");
  });

  it("keeps the documented paths first: called_number and initial_context win over every alias", () => {
    const payload = parseDograhWebhookBody({
      callId: "a",
      called_number: "+15550001111",
      to: "+19999999999",
      called: "+18888888888",
      initial_context: { called_number: "+17777777777", to: "+16666666666" },
      call: { to: "+15555555555" },
    })!;
    expect(payload.calledNumber).toBe("+15550001111");

    // initial_context.called_number (the second documented path) still beats `to`.
    const nested = parseDograhWebhookBody({
      callId: "b",
      initial_context: { called_number: "+12137771235" },
      to: "+19999999999",
    })!;
    expect(nested.calledNumber).toBe("+12137771235");
  });

  it("leaves the caller number on its documented paths only", () => {
    const payload = parseDograhWebhookBody({
      callId: "a",
      to: "+15550001111",
      from: "+15550000123",
      call: { from: "+15550000999" },
    })!;
    expect(payload.callerNumber).toBe("");
    expect(payload.calledNumber).toBe("+15550001111");
  });

  it("still reports a missing number as empty when nothing matches", () => {
    expect(
      parseDograhWebhookBody({ callId: "a", to: "   ", unrelated: "+15550001111" })!.calledNumber
    ).toBe("");
  });
});

describe("describeTopLevelKeys — diagnostics without values", () => {
  it("lists top-level names sorted, and never values", () => {
    const line = describeTopLevelKeys({
      status: "completed",
      callId: "c-1",
      transcript: "the caller said something private",
    });
    expect(line).toBe("callId, status, transcript");
    expect(line).not.toContain("the caller said something private");
    expect(line).not.toContain("completed");
  });

  it("lists only the TOP level of a nested payload", () => {
    expect(describeTopLevelKeys({ callId: "c", call: { to: "+15550001111" } })).toBe(
      "call, callId"
    );
  });

  it("reports (none) for non-object bodies and empty objects", () => {
    expect(describeTopLevelKeys(null)).toBe("(none)");
    expect(describeTopLevelKeys("not-an-object")).toBe("(none)");
    expect(describeTopLevelKeys([1, 2])).toBe("(none)");
    expect(describeTopLevelKeys({})).toBe("(none)");
  });
});