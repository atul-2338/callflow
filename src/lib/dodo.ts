import DodoPayments from "dodopayments";

export const DODO_TRIAL_DAYS = 3;
export const DODO_SOLO_PRICE_USD_CENTS = 4900;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

/**
 * Dodo's SDK defaults to `live_mode` when `environment` is omitted, so the
 * value is narrowed here: anything but the exact string `live_mode` selects
 * test mode. A typo or unset variable can never start charging real cards.
 */
export function getDodoEnvironment(): "test_mode" | "live_mode" {
  return process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode";
}

export function getDodoClient(): DodoPayments {
  return new DodoPayments({
    bearerToken: requiredEnv("DODO_PAYMENTS_API_KEY"),
    environment: getDodoEnvironment(),
    // Optional here: only `webhooks.unwrap()` needs it, and the webhook route
    // reads the secret directly so it stays usable before the API key is set.
    webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_SECRET?.trim() || null,
  });
}

export function getDodoWebhookSecret(): string {
  return requiredEnv("DODO_PAYMENTS_WEBHOOK_SECRET");
}

export function getDodoSoloProductId(): string {
  return requiredEnv("DODO_SOLO_PRODUCT_ID");
}

function absoluteUrl(value: string, name: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
}

/**
 * Where Dodo sends the customer back to after checkout. It must be Callflow's
 * own verification page (`/checkout/return`), not a dashboard: the redirect is
 * a hint, never proof of payment — access is granted by the webhook alone.
 */
export function getDodoReturnUrl(): string {
  return absoluteUrl(requiredEnv("DODO_PAYMENTS_RETURN_URL"), "DODO_PAYMENTS_RETURN_URL");
}

/**
 * Where Dodo's in-checkout back/cancel control goes. Defaults to the same origin
 * as the return URL with the `/onboarding` path, so an abandoned checkout lands
 * the customer back on the wizard rather than on the success page.
 */
export function getDodoCancelUrl(): string {
  const explicit = process.env.DODO_PAYMENTS_CANCEL_URL?.trim();
  if (explicit) return absoluteUrl(explicit, "DODO_PAYMENTS_CANCEL_URL");

  const url = new URL(getDodoReturnUrl());
  url.pathname = "/onboarding";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Where the Dodo customer portal's "return to business" control points. */
export function getDodoPortalReturnUrl(): string {
  const url = new URL(getDodoReturnUrl());
  url.pathname = "/settings";
  url.search = "";
  url.hash = "";
  return url.toString();
}