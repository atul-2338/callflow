import { randomUUID } from "crypto";

/**
 * Fixture payloads shaped EXACTLY like what Dograh's webhook node sends with
 * the Callflow-recommended payload template: every value is a string (the
 * platform's template renderer stringifies everything) and the context dicts
 * are JSON-encoded strings.
 *
 * Used by /api/webhooks/dograh/test and by the vitest suites.
 */

export const DOGRAH_FIXTURE_NAMES = [
  "booked",
  "callback",
  "voicemail",
  "handled",
  "unmatched",
] as const;

export type DograhFixtureName = (typeof DOGRAH_FIXTURE_NAMES)[number];

const PLIVO_NUMBER = "+15559998888";

const CALLER = "+15550000123";

export interface DograhFixtureOverrides {
  caller_number?: string;
  called_number?: string;
  workflow_run_id?: string;
  delivery_id?: string;
}

export interface DograhFixture {
  payload: Record<string, unknown>;
  headers: Record<string, string>;
}

function hoursAgoIso(): string {
  return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
}

const DISPOSITIONS: Record<DograhFixtureName, [string, string]> = {
  booked: ["appointment_booked", "appointment_booked"],
  callback: ["callback_requested", "callback_requested"],
  voicemail: ["voicemail_detected", "voicemail_detected"],
  handled: ["information_provided", "information_provided"],
  unmatched: ["unknown", "unknown"],
};

export function buildDograhFixture(
  name: DograhFixtureName,
  overrides: DograhFixtureOverrides = {}
): DograhFixture {
  if (!DOGRAH_FIXTURE_NAMES.includes(name)) {
    throw new Error(`unknown fixture "${name}"`);
  }
  const runId = overrides.workflow_run_id ?? `fx-${name}-${randomUUID().slice(0, 8)}`;
  const deliveryId = overrides.delivery_id ?? randomUUID();
  const callerNumber = overrides.caller_number ?? CALLER;
  const calledNumber =
    overrides.called_number ?? (name === "unmatched" ? "+19998887777" : PLIVO_NUMBER);
  const [disposition, mapped] = DISPOSITIONS[name];
  const isVoicemail = name === "voicemail";

  const gathered: Record<string, string> = {
    call_disposition: disposition,
    mapped_call_disposition: mapped,
    caller_number: callerNumber,
  };
  if (name === "booked" || name === "callback") {
    gathered.customer_name = "Priya Raman";
  }
  if (name === "booked") {
    gathered.appointment_details = "Thu Sep 18 at 3:00 PM";
    gathered.calendar_event_id = "evt_fixture_9f2c";
  }
  if (isVoicemail) {
    gathered.customer_name = "Sam Torres";
  }

  const payload: Record<string, unknown> = {
    workflow_run_id: runId,
    workflow_name: "Callflow pilot agent",
    call_time: hoursAgoIso(),
    direction: "inbound",
    caller_number: callerNumber,
    called_number: calledNumber,
    call_disposition: disposition,
    mapped_call_disposition: mapped,
    duration_seconds: isVoicemail ? "47" : "184",
    recording_url: `https://app.dograh.com/public/download/workflow/${runId}/recording`,
    transcript_url: `https://app.dograh.com/public/download/workflow/${runId}/transcript`,
    initial_context: JSON.stringify({
      direction: "inbound",
      caller_number: callerNumber,
      called_number: calledNumber,
    }),
    gathered_context: JSON.stringify(gathered),
    cost_info: JSON.stringify({ call_duration_seconds: isVoicemail ? "47" : "184" }),
  };
  if (isVoicemail) {
    // The agent's voicemail branch stores transcript text in a variable that
    // the template can inline directly.
    payload.transcript =
      "Hi, this is Sam — calling about the faucet leak from last week, please call back.";
  }

  return {
    payload,
    headers: {
      "content-type": "application/json",
      "x-dograh-delivery-id": deliveryId,
      "x-dograh-workflow-run-id": runId,
      "x-dograh-delivery-attempt": "1",
    },
  };
}
