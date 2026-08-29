import { lamlResponse } from "@/lib/laml";
import { parseWebhookFields } from "@/lib/webhook";
import { debugLog } from "@/lib/util";
import {
  addActivityLog,
  addCall,
  getCallBySignalwireSid,
  updateCall,
  upsertContactByPhone,
} from "@/lib/db";

// Called by SignalWire after the <Record> completes in /api/ivr/dial-result.
export async function POST(request: Request) {
  const fields = await parseWebhookFields(request);
  const recordingUrl = fields.RecordingUrl || fields.recordingUrl || "";
  const transcript = fields.TranscriptionText || fields.transcriptionText || "";
  const callerNumber = fields.From || fields.from || "";
  const callSid = fields.CallSid || fields.callSid || "";

  debugLog("[IVR recording-complete]", {
    callerNumber,
    callSid,
    recordingUrl: recordingUrl ? "present" : "missing",
    transcript: transcript ? "present" : "missing",
  });

  const now = new Date().toISOString();

  const existing = await getCallBySignalwireSid(callSid);
  if (existing) {
    await updateCall(existing.id, {
      callStatus: "voicemail_left",
      recordingUrl: recordingUrl || null,
      transcript: transcript || null,
      callEndedAt: now,
    });
  } else {
    await addCall({
      businessId: null,
      callerNumber,
      businessNumber: fields.To || fields.to || "",
      callStatus: "voicemail_left",
      callStartedAt: now,
      callEndedAt: now,
      durationSeconds: null,
      textBackSent: false,
      textBackSentAt: null,
      signalwireCallSid: callSid || null,
      recordingUrl: recordingUrl || null,
      transcript: transcript || null,
    });
  }

  if (callerNumber) {
    const contact = await upsertContactByPhone(callerNumber, "Missed Call");
    await addActivityLog({
      contactId: contact.id,
      type: "missed_call",
      message: transcript
        ? `Voicemail from ${callerNumber}: "${transcript}"`
        : `Voicemail left by ${callerNumber}`,
    });
  }

  return lamlResponse(`<Say>Thank you, goodbye.</Say><Hangup />`);
}
