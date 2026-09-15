import { describe, expect, it } from "vitest";
import {
  extractDograhEvent,
  flattenTranscript,
  isDograhRequestAuthorized,
  mapDispositionToOutcome,
} from "./dograh";
import { buildDograhFixture } from "./dograh-fixtures";

function headerMap(entries: Record<string, string>) {
  return {
    get: (name: string) => entries[name.toLowerCase()] ?? null,
  };
}

describe("extractDograhEvent — stringified template payloads", () => {
  it("parses the recommended top-level template", () => {
    const { payload, headers } = buildDograhFixture("booked");
    const event = extractDograhEvent(payload, headerMap(headers))!;
    expect(event).toMatchObject({
      outcome: "booked",
      callStatus: "answered",
      callerNumber: "+15550000123",
      calledNumber: "+15559998888",
      durationSeconds: 184,
      customerName: "Priya Raman",
      calendarEventId: "evt_fixture_9f2c",
      direction: "inbound",
    });
    expect(event.endedAt).not.toBeNull();
    expect(Date.parse(event.endedAt!) - Date.parse(event.startedAt)).toBe(184_000);
  });

  it("reads stringified nested contexts with no top-level keys", () => {
    const event = extractDograhEvent({
      initial_context:
        '{"direction":"inbound","caller_number":"+15551112222","called_number":"+15553334444"}',
      gathered_context: '{"call_disposition":"callback_requested","customer_name":"Jo"}',
      workflow_run_id: "4217",
    })!;
    expect(event).toMatchObject({
      runId: "4217",
      callerNumber: "+15551112222",
      calledNumber: "+15553334444",
      outcome: "callback",
      customerName: "Jo",
    });
  });

  it("falls back to Dograh delivery headers", () => {
    const event = extractDograhEvent(
      { caller_number: "+15551112222" },
      headerMap({
        "x-dograh-delivery-id": "del-9",
        "x-dograh-workflow-run-id": "run-9",
      })
    )!;
    expect(event.deliveryId).toBe("del-9");
    expect(event.runId).toBe("run-9");
    expect(event.outcome).toBe("other");
  });

  it("rejects payloads with neither a caller nor a run id", () => {
    expect(extractDograhEvent({ junk: "value" })).toBeNull();
  });

  it("treats naive isoformat timestamps as UTC", () => {
    const event = extractDograhEvent({
      caller_number: "+15551112222",
      call_time: "2026-09-15T10:00:00",
    })!;
    expect(event.startedAt).toBe("2026-09-15T10:00:00.000Z");
  });
});

describe("disposition → outcome mapping", () => {
  it.each([
    ["appointment_booked", "booked"],
    ["API-Booked", "booked"],
    ["callback requested", "callback"],
    ["voicemail_detected", "voicemail"],
    ["information_provided", "handled"],
    ["some_new_dograh_code", "other"],
    ["", "other"],
  ])("maps %s to %s", (disposition, outcome) => {
    expect(mapDispositionToOutcome(disposition)).toBe(outcome);
  });

  it("maps voicemail dispositions to the voicemail_left call status", () => {
    const event = extractDograhEvent({
      caller_number: "+15551112222",
      mapped_call_disposition: "voicemail_detected",
    })!;
    expect(event.callStatus).toBe("voicemail_left");
  });

  it("maps zero-duration no_answer to missed", () => {
    const event = extractDograhEvent({
      caller_number: "+15551112222",
      call_disposition: "no_answer",
      duration_seconds: "0",
    })!;
    expect(event.callStatus).toBe("missed");
  });
});

describe("flattenTranscript", () => {
  it("renders turn arrays as Caller/Agent lines", () => {
    const raw = JSON.stringify([
      { speaker: "user", text: "Hi, do you take new patients?" },
      { speaker: "bot", text: "Yes! When works for you?" },
    ]);
    expect(flattenTranscript(raw)).toBe(
      "Caller: Hi, do you take new patients?\nAgent: Yes! When works for you?"
    );
  });

  it("handles {transcript:[{role,content}]} shapes", () => {
    const raw = JSON.stringify({ transcript: [{ role: "assistant", content: "Hello" }] });
    expect(flattenTranscript(raw)).toBe("Agent: Hello");
  });

  it("keeps plain text and broken JSON as-is", () => {
    expect(flattenTranscript("left a message")).toBe("left a message");
    expect(flattenTranscript('{"broken": ')).toBe('{"broken":');
    expect(flattenTranscript(null)).toBeNull();
  });

});

describe("isDograhRequestAuthorized", () => {
  const emptyQuery = new URLSearchParams();

  it("is open when DOGRAH_WEBHOOK_SECRET is unset", () => {
    expect(isDograhRequestAuthorized(headerMap({}), emptyQuery)).toBe(true);
  });

  it("accepts the custom header, bearer auth and ?key= fallbacks", () => {
    process.env.DOGRAH_WEBHOOK_SECRET = "s3cret";
    try {
      expect(
        isDograhRequestAuthorized(headerMap({ "x-callflow-secret": "s3cret" }), emptyQuery)
      ).toBe(true);
      expect(
        isDograhRequestAuthorized(
          headerMap({ authorization: "Bearer s3cret" }),
          emptyQuery
        )
      ).toBe(true);
      expect(
        isDograhRequestAuthorized(headerMap({}), new URLSearchParams("key=s3cret"))
      ).toBe(true);
    } finally {
      delete process.env.DOGRAH_WEBHOOK_SECRET;
    }
  });

  it("rejects wrong or missing secrets", () => {
    process.env.DOGRAH_WEBHOOK_SECRET = "s3cret";
    try {
      expect(
        isDograhRequestAuthorized(headerMap({ "x-callflow-secret": "wrong" }), emptyQuery)
      ).toBe(false);
      expect(isDograhRequestAuthorized(headerMap({}), emptyQuery)).toBe(false);
    } finally {
      delete process.env.DOGRAH_WEBHOOK_SECRET;
    }
  });
});
