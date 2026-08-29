import { escapeXml, lamlResponse } from "@/lib/laml";
import { normalizeEnvValue } from "@/lib/util";

// SignalWire voice webhook entry point.
// Configure the SignalWire number's "Voice" webhook URL to
//   https://<your-domain>/api/ivr/incoming-call
// in the SignalWire dashboard (this must also be set there, not just in code).
export async function POST() {
  const ownerNumber = normalizeEnvValue(process.env.BUSINESS_OWNER_NUMBER);

  if (!ownerNumber) {
    // No owner number configured — go straight to voicemail.
    return lamlResponse(
      `<Say>Sorry we missed your call. Please leave your message after the beep.</Say>` +
        `<Record maxLength="60" action="/api/ivr/recording-complete" method="POST" transcribe="true" />`
    );
  }

  return lamlResponse(
    `<Dial timeout="20" action="/api/ivr/dial-result" method="POST">` +
      `<Number>${escapeXml(ownerNumber)}</Number>` +
      `</Dial>`
  );
}

export async function GET() {
  return lamlResponse(
    `<Say>CallFlow IVR is active. This endpoint expects an inbound phone call.</Say>`
  );
}
