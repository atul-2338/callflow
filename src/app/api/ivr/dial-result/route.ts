import { lamlResponse } from "@/lib/laml";
import { parseWebhookFields } from "@/lib/webhook";
import { getBusinessFcmToken } from "@/lib/db";
import { notifyMissedCall } from "@/lib/firebase";
import { debugLog } from "@/lib/util";

// Called by SignalWire after the <Dial> in /api/ivr/incoming-call finishes.
export async function POST(request: Request) {
  const fields = await parseWebhookFields(request);
  const dialCallStatus = (fields.DialCallStatus || fields.dialCallStatus || "").toLowerCase();
  const callerNumber = fields.From || fields.from || "";
  const callSid = fields.CallSid || fields.callSid || "";

  debugLog("[IVR dial-result]", { dialCallStatus, callerNumber, callSid });

  if (dialCallStatus === "completed") {
    // Owner answered — nothing more to do.
    return lamlResponse("");
  }

  // Fire the push notification in parallel with the voicemail flow, but
  // surface the outcome so delivery failures aren't silent.
  const fcmToken = await getBusinessFcmToken();
  notifyMissedCall(fcmToken, callerNumber)
    .then((result) => {
      if (!result.sent) {
        console.error("[FCM] notifyMissedCall failed:", result.error);
      }
    })
    .catch((err) => {
      console.error("[FCM] notifyMissedCall error:", err);
    });

  return lamlResponse(
    `<Say>Sorry we missed your call. Please leave your message after the beep.</Say>` +
      `<Record maxLength="60" action="/api/ivr/recording-complete" method="POST" transcribe="true" />`
  );
}
