import {
  isSignalWireConfigured,
  sendSms as sendSignalWireSms,
  validateSignalWireConfig,
} from "./signalwire";

export type SmsProvider = "signalwire";

export interface SendSmsResult {
  sid: string;
  provider: SmsProvider;
}

export function isSmsConfigured(): boolean {
  return isSignalWireConfigured();
}

export function getSmsProvider(): SmsProvider {
  return "signalwire";
}

export function getSmsProviderInfo() {
  const provider: SmsProvider = "signalwire";
  const validation = validateSignalWireConfig();
  return {
    provider,
    isConfigured: validation.valid,
    note: validation.valid
      ? "Using SignalWire SMS."
      : "SignalWire SMS not configured — set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_API_TOKEN, SIGNALWIRE_SPACE_URL, and SIGNALWIRE_FROM_NUMBER in .env.local.",
    errors: validation.errors,
  };
}

export async function sendOutboundSms(
  to: string,
  body: string
): Promise<SendSmsResult> {
  const result = await sendSignalWireSms(to, body);
  return { sid: result.sid, provider: "signalwire" };
}
