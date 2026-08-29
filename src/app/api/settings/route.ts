import { NextResponse } from "next/server";
import { getBusinessFcmToken, getSettings, saveSettings } from "@/lib/db";
import { getSmsProviderInfo } from "@/lib/sms";
import { validateSignalWireConfig } from "@/lib/signalwire";
import { isFirebaseConfigured } from "@/lib/firebase";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";
import { maskValue, normalizeEnvValue } from "@/lib/util";

export async function GET() {
  const settings = await getSettings();
  const signalwire = validateSignalWireConfig();
  const sms = getSmsProviderInfo();
  const fcmToken = await getBusinessFcmToken();

  return NextResponse.json({
    missedCallReplyTemplate: settings.missedCallReplyTemplate,
    isConfigured: sms.isConfigured,
    smsProvider: sms.provider,
    smsConfigured: sms.isConfigured,
    smsNote: sms.note,
    credentialsSource: "env",
    configErrors: signalwire.errors,
    hasFcmToken: Boolean(fcmToken),
    firebaseConfigured: isFirebaseConfigured(),
    businessOwnerNumber: normalizeEnvValue(process.env.BUSINESS_OWNER_NUMBER)
      ? maskValue(normalizeEnvValue(process.env.BUSINESS_OWNER_NUMBER), 4)
      : "",
    ivrWebhookUrl: "/api/ivr/incoming-call",
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const { missedCallReplyTemplate, fcmToken } = body;

    const settings = await saveSettings({
      missedCallReplyTemplate:
        missedCallReplyTemplate?.trim() ||
        "Sorry we missed your call! We'll get back to you shortly.",
      fcmToken: fcmToken?.trim() || "",
    });

    const signalwire = validateSignalWireConfig();
    const sms = getSmsProviderInfo();

    return NextResponse.json({
      success: true,
      missedCallReplyTemplate: settings.missedCallReplyTemplate,
      isConfigured: sms.isConfigured,
      smsProvider: sms.provider,
      smsConfigured: sms.isConfigured,
      smsNote: sms.note,
      credentialsSource: "env",
      configErrors: signalwire.errors,
      hasFcmToken: Boolean(settings.fcmToken),
      firebaseConfigured: isFirebaseConfigured(),
      businessOwnerNumber: normalizeEnvValue(process.env.BUSINESS_OWNER_NUMBER)
        ? maskValue(normalizeEnvValue(process.env.BUSINESS_OWNER_NUMBER), 4)
        : "",
      ivrWebhookUrl: "/api/ivr/incoming-call",
    });
  } catch {
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
