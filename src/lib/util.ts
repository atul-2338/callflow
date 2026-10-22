import { randomBytes } from "crypto";
import {
  isValidPhoneNumber,
  parsePhoneNumber,
  type CountryCode,
} from "libphonenumber-js";

export function normalizeEnvValue(value: string | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^\[|\]$/g, "");
}

export function formatTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function maskValue(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible) return "•".repeat(value.length);
  return value.slice(0, visible) + "•".repeat(Math.min(value.length - visible, 20));
}

export function isDebug(): boolean {
  return (
    normalizeEnvValue(process.env.DEBUG) === "1" ||
    normalizeEnvValue(process.env.DEBUG)?.toLowerCase() === "true"
  );
}

export function debugLog(...args: unknown[]): void {
  if (isDebug()) console.log(...args);
}

export function digitCount(value: string): number {
  return (value.match(/\d/g) || []).length;
}

export function isValidPhone(value: string): boolean {
  return digitCount(value) >= 10;
}

/**
 * Strict international phone validation (E.164 with country code), matching
 * what Dodo Payments accepts when creating a customer. The loose
 * `isValidPhone` (10+ digits) passes numbers Dodo rejects — e.g. +1555826572
 * is 10 digits but not a real US number — so the billing path must use this
 * stricter check.
 */
export function isValidInternationalPhone(value: string): boolean {
  return isValidPhoneNumber(value);
}

/**
 * Normalize a user-entered phone number to E.164 (e.g. "18568243790" →
 * "+18568243790"). Accepts already-E.164 input, formatted input, or a bare
 * national number resolved against `defaultCountry`. Throws with a
 * human-readable message when the number cannot be parsed as valid.
 */
export function toE164InternationalPhone(
  value: string,
  defaultCountry = "US"
): string {
  const cleaned = value.replace(/[^\d+]/g, "");
  if (isValidPhoneNumber(cleaned)) return cleaned;
  try {
    const parsed = parsePhoneNumber(cleaned, defaultCountry as CountryCode);
    if (parsed?.isValid()) return parsed.number;
  } catch {
    // fall through to the friendly error below
  }
  throw new Error(
    "Business phone number must be a valid international number with country code (e.g. +1 555 123 4567)."
  );
}

/**
 * A business's permanent public identifier: "TE-" + 8 lowercase hex chars
 * (e.g. "TE-9a8b7c6d"). The TE- prefix marks businesses enrolled through the
 * trial onboarding flow — every business gets one, and the value is assigned
 * exactly once at creation and never rotated afterwards.
 *
 * 8 hex chars = 4 bytes of uniform randomness from crypto.randomBytes, which
 * gives exactly 8 hex characters without slicing a UUID string (a UUID's
 * version/variant bits are not uniformly random). Callers must treat the
 * returned value as opaque and check uniqueness against the businesses table
 * (see createBusiness and backfillBusinessClientUids); the partial unique
 * index idx_businesses_client_uid is the storage-level backstop.
 */
export function generateClientUid(): string {
  return `TE-${randomBytes(4).toString("hex")}`;
}