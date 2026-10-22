import nodemailer from "nodemailer";
import { normalizeEnvValue } from "./util";

/**
 * Email alerts for new calls (nodemailer over plain SMTP).
 *
 * The Dograh webhook sends one alert right after a NEW call row is saved —
 * never for duplicate deliveries, and never in a way that can fail the
 * webhook itself: every send is wrapped and returns a result instead of
 * throwing.
 *
 * Configuration (all five required; missing values skip the send with one
 * clear warning — see .env.example):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

export interface SmtpConfig {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
}

const SMTP_ENV_VARS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
] as const;

/**
 * Null when SMTP is fully configured; otherwise a plain-English reason that
 * names exactly what is missing — for the one warning the caller must log.
 */
export function smtpConfigError(
  env: Record<string, string | undefined> = process.env
): string | null {
  const missing = SMTP_ENV_VARS.filter((name) => !normalizeEnvValue(env[name]));
  if (missing.length) {
    return `missing ${missing.join(", ")} (set them in .env.local — see .env.example)`;
  }
  const port = Number(normalizeEnvValue(env.SMTP_PORT));
  if (!Number.isFinite(port) || port <= 0) {
    return `SMTP_PORT "${normalizeEnvValue(env.SMTP_PORT)}" is not a valid port number`;
  }
  return null;
}

export function readSmtpConfig(
  env: Record<string, string | undefined> = process.env
): SmtpConfig | null {
  if (smtpConfigError(env)) return null;
  return {
    host: normalizeEnvValue(env.SMTP_HOST),
    port: Number(normalizeEnvValue(env.SMTP_PORT)),
    user: normalizeEnvValue(env.SMTP_USER) || null,
    pass: normalizeEnvValue(env.SMTP_PASS) || null,
    from: normalizeEnvValue(env.SMTP_FROM),
  };
}

export interface CallAlertEmailInput {
  /** Caller's name as captured by the agent, or "" when unknown. */
  name: string;
  /** Canonical urgency ("emergency" | "today" | "this_week" | "flexible") or
   * any raw label the workflow sent; null when not captured. */
  urgency: string | null;
  /** What the caller needs (serviceRequested), or null when not captured. */
  reason: string | null;
  /** Number to call back (callback number or caller number), or null. */
  callbackNumber: string | null;
  /** ISO timestamp of when the call started. */
  startedAt: string;
  /** Dograh recording URL, or null when there is none. */
  recordingUrl: string | null;
  /** Absolute URL of the call dashboard. */
  dashboardUrl: string;
}

/** Subject per the alert contract: EMERGENCY short-circuits everything else. */
export function callAlertSubject(input: CallAlertEmailInput): string {
  const name = input.name.trim() || "Unknown caller";
  const urgency = input.urgency?.trim() || "New";
  if (urgency.toLowerCase() === "emergency") {
    return `EMERGENCY call from ${name}`;
  }
  return `New call from ${name} (${urgency})`;
}

/** E.164-ish → "tel:+15551234567"; "" when there is no number to dial. */
export function telHref(callbackNumber: string | null): string {
  const digits = (callbackNumber ?? "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

/** ISO stamp → "2026-10-07 06:35 UTC" (unambiguous, no server timezone);
 * unparseable input is returned as-is. */
export function formatCallTime(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildCallAlertEmail(input: CallAlertEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const name = input.name.trim() || "Unknown caller";
  const subject = callAlertSubject(input);
  const time = formatCallTime(input.startedAt);
  const callback = input.callbackNumber?.trim() || "";
  const tel = telHref(callback);
  const reason = input.reason?.trim() || "(not captured)";
  const recording = input.recordingUrl?.trim() || "";

  const textLines = [
    `You have a new call from your Callflow agent (${name}).`,
    ``,
    `What they need: ${reason}`,
    callback ? `Call them back: ${callback}` : null,
    `Call time: ${time}`,
    recording ? `Listen to the recording: ${recording}` : null,
    `Open the dashboard: ${input.dashboardUrl}`,
  ].filter((line): line is string => line !== null);

  const htmlCallback = callback
    ? tel
      ? `<a href="${escapeHtml(tel)}">${escapeHtml(callback)}</a>`
      : escapeHtml(callback)
    : null;
  const htmlLines = [
    `<p>You have a new call from your Callflow agent (${escapeHtml(name)}).</p>`,
    `<p><strong>What they need:</strong> ${escapeHtml(reason)}</p>`,
    htmlCallback ? `<p><strong>Call them back:</strong> ${htmlCallback}</p>` : null,
    `<p><strong>Call time:</strong> ${escapeHtml(time)}</p>`,
    recording
      ? `<p><strong>Listen to the recording:</strong> <a href="${escapeHtml(recording)}">${escapeHtml(recording)}</a></p>`
      : null,
    `<p><a href="${escapeHtml(input.dashboardUrl)}">Open the dashboard</a></p>`,
  ].filter((line): line is string => line !== null);

  return {
    subject,
    text: textLines.join("\n"),
    html: htmlLines.join("\n"),
  };
}

export interface EmailSendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send one call alert. NEVER throws — configuration and SMTP problems are
 * returned as `{ sent: false, error }` so the webhook can always respond 200.
 */
export async function sendCallAlertEmail(
  config: SmtpConfig,
  to: string,
  input: CallAlertEmailInput
): Promise<EmailSendResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth:
        config.user && config.pass
          ? { user: config.user, pass: config.pass }
          : undefined,
    });
    try {
      const { subject, text, html } = buildCallAlertEmail(input);
      const info = await transporter.sendMail({
        from: config.from,
        to,
        subject,
        text,
        html,
      });
      return { sent: true, messageId: info?.messageId ?? undefined };
    } finally {
      transporter.close();
    }
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Email send failed",
    };
  }
}