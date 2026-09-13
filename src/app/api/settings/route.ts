import { NextResponse } from "next/server";
import { getBusinessFcmToken, getSettings, saveSettings } from "@/lib/db";
import { isFirebaseConfigured } from "@/lib/firebase";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";

export async function GET() {
  const settings = await getSettings();
  const fcmToken = await getBusinessFcmToken();

  return NextResponse.json({
    missedCallReplyTemplate: settings.missedCallReplyTemplate,
    hasFcmToken: Boolean(fcmToken),
    firebaseConfigured: isFirebaseConfigured(),
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

    return NextResponse.json({
      success: true,
      missedCallReplyTemplate: settings.missedCallReplyTemplate,
      hasFcmToken: Boolean(settings.fcmToken),
      firebaseConfigured: isFirebaseConfigured(),
    });
  } catch {
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
