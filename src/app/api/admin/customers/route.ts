/**
 * POST /api/admin/customers — admin-only "Create customer".
 *
 * Guarded like every /api/admin/* route (requireAdminApi on the first line,
 * and the owner's callflow_business_session cookie is never accepted here), so
 * business owners cannot reach this. The body is
 * `{ businessName, ownerName, ownerEmail, ownerPhone, assignedNumber }`; all
 * five are required. The assigned number must be the strict pool format
 * ("+1" + 10 digits) and the owner phone any parseable number, normalized to
 * E.164 exactly as onboarding normalizes it.
 *
 * Creation lives in src/lib/admin-customers.ts (one SQLite transaction) and
 * starts the 3-day trial with no payment. Two links come back and both are
 * handed to the owner: the one-time LOGIN link (src/app/owner-login/route.ts)
 * and a 48-hour password-SETUP link, which is emailed to the owner here (best
 * effort — SMTP trouble never fails the creation) and also returned as
 * `setupUrl` so the admin can pass it on by hand. Neither link, nor either
 * token, is ever written to the audit trail — only their expiries are.
 */
import { NextResponse } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import {
  CustomerNumberTakenError,
  CustomerOwnerPhoneTakenError,
  createAdminCustomer,
  ownerLoginUrl,
  requestOrigin,
} from "@/lib/admin-customers";
import { requireAdminApi } from "@/lib/admin-session";
import { BUSINESS_NAME_TAKEN_ERROR, BusinessNameTakenError } from "@/lib/billing";
import { setupPasswordUrl } from "@/lib/business-password";
import { readSmtpConfig, sendOperatorAlertEmail, type EmailSendResult } from "@/lib/email";
import { isValidPoolNumber, normalizeOwnerPhone } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Emails the password-setup link to the new owner.
 *
 * Best-effort by design: the business row is already committed, so a mail
 * failure must never turn a successful creation into an error. The link is also
 * returned to the admin in the response (setupUrl), so a missed email is
 * recoverable by hand — and the owner can always sign in with the login link.
 *
 * Sent through the existing nodemailer/SMTP setup (src/lib/email.ts) — the same
 * transport the call alerts already use. Resend is not installed in this repo
 * and no RESEND_API_KEY is configured.
 */
async function sendOwnerSetupLinkEmail(args: {
  to: string;
  ownerName: string;
  businessName: string;
  url: string;
}): Promise<EmailSendResult> {
  const config = readSmtpConfig();
  if (!config) {
    console.error(
      "[admin-customers] SMTP not configured — the owner setup link was NOT emailed. " +
        "Copy setupUrl from this response and send it another way (see .env.example)."
    );
    return { sent: false, error: "SMTP not configured" };
  }

  const firstName = args.ownerName.trim().split(/\s+/)[0] || "there";
  const result = await sendOperatorAlertEmail(
    config,
    args.to,
    "Your CallFlow account is ready",
    `Hi ${firstName},\n\n` +
      `your CallFlow account is set up. Create your password here:\n` +
      `${args.url}\n\n` +
      `This link expires in 48 hours.\n\n` +
      `If it expires, ask your CallFlow contact for a new one — you can also sign\n` +
      `in any time with the login link you were given.\n\n` +
      `— CallFlow`
  );
  if (!result.sent) {
    console.error(`[admin-customers] setup email not sent: ${result.error}`);
  }
  return result;
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = requireAdminApi(request);
  if (guard) return guard;

  // Every create mints a real number and a working account, so cap it per IP:
  // a stolen admin cookie should not be able to spin up rows without limit.
  const limit = rateLimit(
    `admin-customer-create:ip:${clientIp(request)}`,
    20,
    60 * 60 * 1000
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many customers created in the last hour. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const read = (key: string) =>
    typeof body[key] === "string" ? (body[key] as string).trim() : "";
  const businessName = read("businessName");
  const ownerName = read("ownerName");
  const ownerEmail = read("ownerEmail").toLowerCase();
  const ownerPhone = normalizeOwnerPhone(read("ownerPhone"));
  const assignedNumber = read("assignedNumber");

  if (!businessName) return badRequest("Business name is required.");
  if (!ownerName) return badRequest("Owner name is required.");
  if (!EMAIL_PATTERN.test(ownerEmail)) return badRequest("Enter a valid owner email address.");
  if (!ownerPhone) {
    return badRequest("Enter a valid owner phone number (e.g. +1 928 331 9394).");
  }
  if (!isValidPoolNumber(assignedNumber)) {
    return badRequest(
      "Assigned number must be E.164: +1 followed by 10 digits (e.g. +17373014448)."
    );
  }

  try {
    const {
      business,
      loginToken,
      loginTokenExpiresAt,
      setupToken,
      setupTokenExpiresAt,
      trialEndsAt,
    } = await createAdminCustomer({
      businessName,
      ownerName,
      ownerEmail,
      ownerPhone,
      assignedNumber,
    });

    // Emailed immediately; a failure only logs (see sendOwnerSetupLinkEmail).
    const setupUrl = setupPasswordUrl(requestOrigin(request), setupToken);
    const setupEmail = await sendOwnerSetupLinkEmail({
      to: ownerEmail,
      ownerName,
      businessName,
      url: setupUrl,
    });

    logAdminAction({
      action: "customer_created",
      target: business.id,
      // Ids and keys only — never the login link, the setup link or either token.
      details: {
        businessName: business.billingName,
        clientUid: business.clientUid,
        assignedNumber: business.assignedNumber,
        trialEndsAt,
        loginTokenExpiresAt,
        setupTokenExpiresAt,
        setupEmailSent: setupEmail.sent,
      },
      ip: clientIp(request),
    });

    return NextResponse.json(
      {
        business: {
          id: business.id,
          clientUid: business.clientUid,
          businessName: business.billingName,
          ownerName: business.ownerName ?? null,
          ownerEmail: business.billingEmail,
          ownerPhone: business.phoneNumber,
          assignedNumber: business.assignedNumber,
          subscriptionStatus: business.subscriptionStatus,
          trialStartedAt: business.trialStartedAt,
        },
        trialEndsAt,
        loginUrl: ownerLoginUrl(requestOrigin(request), loginToken),
        loginTokenExpiresAt,
        // The password-setup link, for the copy-paste fallback when SMTP is
        // down (setupEmailSent says which case this was).
        setupUrl,
        setupTokenExpiresAt,
        setupEmailSent: setupEmail.sent,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof BusinessNameTakenError) {
      return NextResponse.json(
        { error: BUSINESS_NAME_TAKEN_ERROR, code: "business_name_taken" },
        { status: 409 }
      );
    }
    if (
      error instanceof CustomerNumberTakenError ||
      error instanceof CustomerOwnerPhoneTakenError
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[admin-customers] create failed", error);
    return NextResponse.json(
      { error: "Could not create the customer. Nothing was saved." },
      { status: 500 }
    );
  }
}
