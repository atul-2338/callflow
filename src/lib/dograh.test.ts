import { describe, expect, it, vi } from "vitest";
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
    // Vitest loads .env.local into process.env, so "unset" must be forced —
    // a developer machine with DOGRAH_WEBHOOK_SECRET configured locally would
    // otherwise fail this test for the wrong reason.
    vi.stubEnv("DOGRAH_WEBHOOK_SECRET", "");
    try {
      expect(isDograhRequestAuthorized(headerMap({}), emptyQuery)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
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
      expect(
        isDograhRequestAuthorized(headerMap({ "x-webhook-secret": "s3cret" }), emptyQuery)
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
      expect(
        isDograhRequestAuthorized(headerMap({ "x-webhook-secret": "wrong" }), emptyQuery)
      ).toBe(false);
    } finally {
      delete process.env.DOGRAH_WEBHOOK_SECRET;
    }
  });
});

describe("extractDograhEvent — MVP job details", () => {
  it("captures service, urgency and callback preference from gathered context", () => {
    const event = extractDograhEvent({
      caller_number: "+15551112222",
      workflow_run_id: "details-1",
      gathered_context: JSON.stringify({
        call_disposition: "callback_requested",
        service_requested: "Water heater leak",
        urgency: "urgent",
        preferred_callback_time: "after 2pm",
      }),
    })!;
    expect(event.serviceRequested).toBe("Water heater leak");
    expect(event.urgency).toBe("urgent");
    expect(event.preferredCallbackTime).toBe("after 2pm");
  });

  it("accepts the alternate template key names", () => {
    const event = extractDograhEvent({
      caller_number: "+15551112222",
      workflow_run_id: "details-1b",
      service_requested: "Broken outlet",
      urgency: "sparks",
    })!;
    expect(event.serviceRequested).toBe("Broken outlet");
    expect(event.urgency).toBe("sparks");
  });

  it("leaves every detail null when the workflow did not capture it", () => {
    const event = extractDograhEvent({
      caller_number: "+15551112222",
      workflow_run_id: "details-2",
    })!;
    expect(event.serviceRequested).toBeNull();
    expect(event.urgency).toBeNull();
    expect(event.preferredCallbackTime).toBeNull();
  });

  it("caps oversized detail values at 200 characters", () => {
    const event = extractDograhEvent({
      caller_number: "+15551112222",
      workflow_run_id: "details-3",
      service_requested: "x".repeat(500),
    })!;
    expect(event.serviceRequested!.length).toBe(200);
  });

  it("the callback fixture carries the MVP details end-to-end", () => {
    const { payload } = buildDograhFixture("callback");
    const event = extractDograhEvent(payload)!;
    expect(event.serviceRequested).toContain("Water heater");
    expect(event.urgency).toBeTruthy();
    expect(event.preferredCallbackTime).toBeTruthy();
  });

  it("the booked fixture keeps details null (template does not gather them)", () => {
    const { payload } = buildDograhFixture("booked");
    const event = extractDograhEvent(payload)!;
    expect(event.serviceRequested).toBeNull();
  });

  it("parses the minimal webhook contract keys (call_id / caller_name / reason)", () => {
    const event = extractDograhEvent({
      call_id: "731013",
      workflow_id: "11658",
      caller_number: "+15551234567",
      caller_name: "Alex",
      callback_number: "",
      reason: "Burst main pipe causing water leakage in kitchen",
      urgency: "emergency",
      duration: "78",
      recording_url: "https://rec.example/731013",
      transcript_url: "https://tr.example/731013",
    })!;
    expect(event).toMatchObject({
      runId: "731013",
      customerName: "Alex",
      callbackNumber: null, // empty string here; fallback happens at storage time
      serviceRequested: "Burst main pipe causing water leakage in kitchen",
      urgency: "emergency",
      durationSeconds: 78,
      recordingUrl: "https://rec.example/731013",
      transcriptUrl: "https://tr.example/731013",
    });
  });

  it("canonicalizes the four urgency levels in any casing, keeps others verbatim", () => {
    const upper = extractDograhEvent({
      caller_number: "+15551112222",
      workflow_run_id: "urg-1",
      urgency: "EMERGENCY",
    })!;
    expect(upper.urgency).toBe("emergency");
    const freeText = extractDograhEvent({
      caller_number: "+15551112222",
      workflow_run_id: "urg-2",
      urgency: "Urgent — water spreading",
    })!;
    expect(freeText.urgency).toBe("Urgent — water spreading");
  });
});