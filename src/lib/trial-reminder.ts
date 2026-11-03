import { isTrialExpired, trialEndsAt } from "./billing";
import { updateBusiness } from "./db";
import { readSmtpConfig, sendOperatorAlertEmail } from "./email";
import type { Business } from "./types";

/**
 * Day-2 trial email (build brief step 5: "email the owner on day 2 of the trial
 * with the charge date").
 *
 * There is no scheduler in this repo (no cron, no queue) and adding one would
 * mean new infrastructure, so the reminder is sent lazily from the dashboard
 * render (`/app`) — the first time the owner comes back on day 2 or later. A
 * one-shot stamp (`businesses.trialReminderEmailAt`) guarantees exactly one
 * email per trial, and the send never throws: the page must render regardless.
 *
 * Deliberately NOT sent when:
 * - there is no trial start (not started),
 * - the trial already expired (the "trial ended" email owns that case),
 * - the trial is younger than DAY_TWO_MS,
 * - the email was already sent, or the business has no email on file.
 */

/** "Day 2" = 48 hours after the trial clock started. */
export const DAY_TWO_MS = 48 * 60 * 60 * 1000;

export type TrialReminderResult =
  | "sent"
  | "not_due"
  | "already_sent"
  | "trial_over"
  | "no_email"
  | "no_smtp"
  | "send_failed";

/** Injectable collaborators, so tests never touch SMTP or the clock. */
export interface ReminderDeps {
  send: typeof sendOperatorAlertEmail;
  readConfig: typeof readSmtpConfig;
  now: () => Date;
}

/** ISO trial end -> "November 6, 2026" (UTC, so the date never shifts). */
export function chargeDateLabel(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Owner-facing address: the alert email first, the billing email second. */
export function ownerEmailFor(business: Business): string {
  return (
    business.notificationEmail?.trim() || business.billingEmail?.trim() || ""
  );
}

/**
 * Send the day-2 reminder when it is due. NEVER throws: every failure is
 * logged and reported as a result, so callers can fire-and-forget it.
 */
export async function trialReminder(
  business: Business,
  deps: Partial<ReminderDeps> = {}
): Promise<TrialReminderResult> {
  const send = deps.send ?? sendOperatorAlertEmail;
  const readConfig = deps.readConfig ?? readSmtpConfig;
  const now = deps.now ? deps.now() : new Date();

  if (!business.trialStartedAt) return "not_due";
  if (isTrialExpired(business.trialStartedAt, now)) return "trial_over";
  if (business.trialReminderEmailAt) return "already_sent";

  const startedAt = new Date(business.trialStartedAt).getTime();
  if (now.getTime() - startedAt < DAY_TWO_MS) return "not_due";

  const to = ownerEmailFor(business);
  if (!to) {
    console.warn(
      "[trial-reminder] Day-2 email skipped: this business has no notification or billing email on file."
    );
    return "no_email";
  }

  const config = readConfig();
  if (!config) {
    console.warn("[trial-reminder] Day-2 email skipped: SMTP is not configured.");
    return "no_smtp";
  }

  const chargeDate = chargeDateLabel(trialEndsAt(business.trialStartedAt));
  const name = business.billingName?.trim() || "your business";
  const result = await send(
    config,
    to,
    `CallFlow: your first payment is on ${chargeDate}`,
    `Hi ${name},\n\n` +
      "your 3-day CallFlow trial ends soon. Your first $49 payment is due on " +
      `${chargeDate}, then monthly after that.\n\n` +
      "Nothing to do if you want to keep your line: the card on file is charged " +
      "automatically and the agent keeps answering your calls.\n" +
      "To cancel or change your card, open your dashboard: " +
      "https://callflow.biz/app\n\n" +
      "— CallFlow"
  );

  if (!result.sent) {
    console.error("[trial-reminder] Day-2 email not sent", {
      businessId: business.id,
      error: result.error,
    });
    return "send_failed";
  }

  await updateBusiness(business.id, {
    trialReminderEmailAt: now.toISOString(),
  });
  return "sent";
}

/** Production wrapper used by the dashboard render. */
export async function maybeSendTrialReminder(
  business: Business
): Promise<TrialReminderResult> {
  return trialReminder(business);
}
