import { toE164InternationalPhone } from "./util";

/**
 * THE one shared phone-number helper (E.164).
 *
 * Every phone write in the app goes through this module:
 * - CallFlow pool numbers (admin textarea, data/phone_numbers.json) are
 *   validated with the strict US format check (`isValidPoolNumber`).
 * - Owner-entered numbers (onboarding, settings) are normalized leniently with
 *   `normalizeOwnerPhone` — it accepts "+1 928 331-9394", "(928) 331-9394",
 *   "9283319394" and returns the canonical "+19283311939"-style E.164 value
 *   that gets stored.
 *
 * The underlying international parser (`toE164InternationalPhone`, also
 * re-exported here so callers have a single import site) is the same code the
 * protected billing signup uses, so an owner number validated here is exactly
 * as valid as the one Dodo accepted at signup.
 */

/** Strict format for CallFlow pool numbers: "+1" followed by exactly 10 digits. */
export const US_POOL_NUMBER_PATTERN = /^\+1\d{10}$/;

/** True when `value` is exactly "+1" + 10 digits (the only pool format). */
export function isValidPoolNumber(value: string): boolean {
  return US_POOL_NUMBER_PATTERN.test(value.trim());
}

export { isValidInternationalPhone, toE164InternationalPhone } from "./util";

/**
 * Lenient owner-input normalization → E.164 string, or `null` when the value
 * cannot be parsed as a valid phone number (never throws — callers just show
 * a validation error).
 */
export function normalizeOwnerPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return toE164InternationalPhone(trimmed);
  } catch {
    return null;
  }
}

/**
 * Area code of a US E.164 number ("+15551234567" → "555"); `null` for anything
 * that is not exactly "+1" + 10 digits. Used only for the pool's
 * same-area-code preference when auto-assigning.
 */
export function usAreaCode(e164: string): string | null {
  if (!US_POOL_NUMBER_PATTERN.test(e164)) return null;
  return e164.slice(2, 5);
}