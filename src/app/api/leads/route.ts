/**
 * POST /api/leads — public lead intake from /start (post-demo follow-up).
 *
 * Unauthenticated by design: this is the page a prospect is sent to right after
 * a demo call, so there is nothing to sign in with. Abuse is bounded by a
 * per-IP rate limit and by strict validation (name, parseable phone, email);
 * nothing is written until all three pass.
 *
 * Every accepted lead also alerts the CallFlow operator over the EXISTING
 * nodemailer/SMTP transport (src/lib/email.ts) — the same one the admin
 * "Create customer" setup link uses. Resend is not installed in this repo and
 * no RESEND_API_KEY exists. The send is best-effort: the lead row is already
 * committed, so SMTP trouble logs one warning and never fails the submission
 * (the lead is in /admin/leads either way).
 *
 * Recipient: LEADS_NOTIFY_EMAIL, falling back to SMTP_FROM (see .env.example).
 * When neither is set, or SMTP itself is unconfigured, the send is skipped with
 * one clear log line and the lead is still saved.
 */
import { NextResponse } from "next/server";

import { createLead } from "@/lib/db";
import { readSmtpConfig, sendOperatorAlertEmail, type EmailSendResult } from "@/lib/email";
import { normalizeOwnerPhone } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { Lead } from "@/lib/types";
import { normalizeEnvValue } from "@/lib/util";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const SUBMISSION_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

/** Where the "new lead" alert goes: explicit override, else the From address. */
export function leadsNotifyAddress(
  env: Record<string, string | undefined> = process.env
): string | null {
  return normalizeEnvValue(env.LEADS_NOTIFY_EMAIL) || normalizeEnvValue(env.SMTP_FROM) || null;
}

/**
 * One plain-text alert to the operator. Deliberately never throws — a broken
 * mail server must not turn a saved lead into an error page for the prospect.
 */
async function notifyNewLead(lead: Lead): Promise<EmailSendResult> {
  const config = readSmtpConfig();
  const to = leadsNotifyAddress();
  if (!config || !to) {
    console.warn(
      "[leads] lead saved but NOT emailed — set SMTP_* and LEADS_NOTIFY_EMAIL (see .env.example)"
    );
    return { sent: false, error: "SMTP not configured" };
  }

  const result = await sendOperatorAlertEmail(
    config,
    to,
    `New CallFlow lead: ${lead.name}`,
    [
      `${lead.name} asked to get started with CallFlow.`,
      "",
      `Name:  ${lead.name}`,
      `Phone: ${lead.phone}`,
      `Email: ${lead.email}`,
      `Submitted: ${lead.createdAt}`,
      "",
      "Work it from /admin/leads.",
    ].join("\n")
  );
  if (!result.sent) {
    console.warn("[leads] operator alert not sent:", result.error);
  }
  return result;
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(`leads:ip:${clientIp(request)}`, SUBMISSION_LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many submissions from this connection. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const name = readString(body, "name");
  const email = readString(body, "email").toLowerCase();
  // Same lenient normalization every owner-entered number gets (src/lib/phone.ts):
  // "(928) 331-9394" and "+1 928 331 9394" both land on one canonical E.164 value.
  const phone = normalizeOwnerPhone(readString(body, "phone"));

  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json(
      { error: "Enter a valid phone number (e.g. +1 928 331 9394)." },
      { status: 400 }
    );
  }
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const lead = await createLead({ name, phone, email });
  await notifyNewLead(lead);

  return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
}
