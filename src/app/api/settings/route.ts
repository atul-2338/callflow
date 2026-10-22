import { NextResponse } from "next/server";
import { businessIdFromCookieHeader } from "@/lib/business-session";
import { resolveCallAccess, unauthorizedCallResponse } from "@/lib/call-access";
import {
  getBusinessById,
  getBusinessFcmToken,
  getSettings,
  saveSettings,
  updateBusiness,
} from "@/lib/db";
import { isFirebaseConfigured } from "@/lib/firebase";

/** Loose-but-honest email shape check for the notification email field. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request) {
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (!businessId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const settings = await getSettings();
  const fcmToken = await getBusinessFcmToken();

  // The saved alert email belongs to the signed-in business, so it is only
  // revealed to that business's session — never to anonymous GETs.
  const business = businessId ? await getBusinessById(businessId) : undefined;

  return NextResponse.json({
    missedCallReplyTemplate: settings.missedCallReplyTemplate,
    hasFcmToken: Boolean(fcmToken),
    firebaseConfigured: isFirebaseConfigured(),
    notificationEmail: business?.notificationEmail ?? null,
    address: business?.address ?? null,
    billingName: business?.billingName ?? null,
    phoneNumber: business?.phoneNumber ?? null,
  });
}

export async function POST(request: Request) {
  // A signed-in business session authorizes this write (same convention as
  // /api/calls); without a session the legacy APP_AUTH_TOKEN bearer applies,
  // and when that token is unset the endpoint stays open in local dev.
  if (!resolveCallAccess(request).authorized) return unauthorizedCallResponse();
  try {
    const body = await request.json();
    const {
      missedCallReplyTemplate,
      fcmToken,
      notificationEmail,
      address,
      billingName,
      phoneNumber,
    } = body;

    const settings = await saveSettings({
      missedCallReplyTemplate:
        missedCallReplyTemplate?.trim() ||
        "Sorry we missed your call! We'll get back to you shortly.",
      fcmToken: fcmToken?.trim() || "",
    });

    // Persist the owner's alert email onto THIS business's record (Settings →
    // Business information → Email). The Dograh webhook sends new-call alert
    // emails to it (src/lib/dograh-webhook.ts + src/lib/email.ts). An empty
    // value clears the saved email and turns alerts off.
    let savedNotificationEmail: string | null = null;
    if (notificationEmail !== undefined) {
      const businessId = businessIdFromCookieHeader(
        request.headers.get("cookie")
      );
      if (!businessId) {
        return NextResponse.json(
          { error: "Sign in to save the notification email" },
          { status: 400 }
        );
      }
      const email =
        typeof notificationEmail === "string" ? notificationEmail.trim() : "";
      if (email && !EMAIL_PATTERN.test(email)) {
        return NextResponse.json(
          { error: "Enter a valid email address" },
          { status: 400 }
        );
      }
      await updateBusiness(businessId, { notificationEmail: email || null });
      savedNotificationEmail = email || null;
    }

    // Persist the business address onto THIS business's record (Settings →
    // Business information → Address). Free-form text; an empty value clears
    // the saved address.
    let savedAddress: string | null = null;
    if (address !== undefined) {
      const businessId = businessIdFromCookieHeader(
        request.headers.get("cookie")
      );
      if (!businessId) {
        return NextResponse.json(
          { error: "Sign in to save the business address" },
          { status: 400 }
        );
      }
      const value = typeof address === "string" ? address.trim() : "";
      await updateBusiness(businessId, { address: value });
      savedAddress = value;
    }

    // Persist the billing name onto THIS business's record (Settings →
    // Business information → Billing name). Free-form text; an empty value
    // clears the saved name.
    let savedBillingName: string | null = null;
    if (billingName !== undefined) {
      const businessId = businessIdFromCookieHeader(
        request.headers.get("cookie")
      );
      if (!businessId) {
        return NextResponse.json(
          { error: "Sign in to save the billing name" },
          { status: 400 }
        );
      }
      const value = typeof billingName === "string" ? billingName.trim() : "";
      await updateBusiness(businessId, { billingName: value || null });
      savedBillingName = value;
    }

    // Persist the phone number onto THIS business's record (Settings →
    // Business information → Phone number). Stored as the trimmed string —
    // the column is the business identity, so it is never nulled.
    let savedPhoneNumber: string | null = null;
    if (phoneNumber !== undefined) {
      const businessId = businessIdFromCookieHeader(
        request.headers.get("cookie")
      );
      if (!businessId) {
        return NextResponse.json(
          { error: "Sign in to save the phone number" },
          { status: 400 }
        );
      }
      const value = typeof phoneNumber === "string" ? phoneNumber.trim() : "";
      await updateBusiness(businessId, { phoneNumber: value });
      savedPhoneNumber = value;
    }

    return NextResponse.json({
      success: true,
      missedCallReplyTemplate: settings.missedCallReplyTemplate,
      hasFcmToken: Boolean(settings.fcmToken),
      firebaseConfigured: isFirebaseConfigured(),
      notificationEmail: savedNotificationEmail,
      address: savedAddress,
      billingName: savedBillingName,
      phoneNumber: savedPhoneNumber,
    });
  } catch {
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
