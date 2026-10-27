import { CARRIERS, type Carrier } from "@/lib/types";

/**
 * Carrier-specific conditional call-forwarding dial codes (star codes / GSM MMI
 * codes).
 *
 * The plumber dials one of these strings on the phone they registered with
 * CallFlow; their carrier then forwards the calls they don't answer to the
 * CallFlow number, where the AI backup answers. This is a one-time,
 * carrier-side setting — CallFlow itself never places or routes those calls
 * (and nothing is dialed server-side during onboarding).
 *
 * Sources:
 * - Verizon: official support docs — *71 + a 10-digit number forwards only the
 *   calls you don't answer (*72 forwards every call, *73 cancels forwarding).
 * - AT&T, T-Mobile, MVNOs, and GSM carriers generally: 3GPP TS 22.030 standard
 *   MMI codes — **61*<number>**11*<seconds># registers no-answer forwarding
 *   with a ring time of <seconds>; ##61# cancels it.
 */

/** Seconds of ring time before unanswered calls forward to CallFlow. */
export const RING_SECONDS = 15;

/** How each carrier's network expects the destination number to be spelled. */
type DestinationFormat =
  | "national10" // bare 10 digits (Verizon CDMA-heritage codes)
  | "onePlus10" // 1 + 10 digits (US GSM carriers)
  | "e164"; // +<country code><number> (international GSM carriers)

interface CarrierSpec {
  /** Carrier display name shown in the UI. */
  label: string;
  /** Star/MMI prefix dialed before the destination number. */
  code: string;
  /** Closing MMI segment appended after the number ("" for Verizon). */
  suffix: string;
  /** Number spelling expected by this carrier's network. */
  format: DestinationFormat;
  /** Code that turns the forwarding back off. */
  cancelCode: string;
  /** Carrier-specific caveats / fallback guidance shown under the instruction. */
  note: string;
}

const GSM_SUFFIX_NOTE =
  "If your phone rejects the 15-second ending, dial **61* and our number, then # instead.";

const SPECS: Record<Carrier, CarrierSpec> = {
  verizon: {
    label: "Verizon",
    code: "*71",
    suffix: "",
    format: "national10",
    cancelCode: "*73",
    note: "Verizon's *71 code forwards only the calls you don't answer. To forward every call instead, dial *72 plus our number. Dial *73 to turn forwarding off.",
  },
  att: {
    label: "AT&T",
    code: "**61*",
    suffix: "**11*15#",
    format: "onePlus10",
    cancelCode: "##61#",
    note: `This is the GSM-standard no-answer code AT&T supports. ${GSM_SUFFIX_NOTE} Dial ##61# to turn forwarding off.`,
  },
  tmobile: {
    label: "T-Mobile",
    code: "**61*",
    suffix: "**11*15#",
    format: "onePlus10",
    cancelCode: "##61#",
    note: `This is the GSM-standard no-answer code T-Mobile supports. ${GSM_SUFFIX_NOTE} Dial ##61# to turn forwarding off.`,
  },
  other: {
    label: "Other / MVNO",
    code: "**61*",
    suffix: "**11*15#",
    format: "onePlus10",
    cancelCode: "##61#",
    note: "Most US carriers — including MVNOs on the big networks — accept this GSM-standard code. If yours rejects it, use the manual phone-settings steps below. Dial ##61# to turn forwarding off.",
  },
  airtel: {
    label: "Airtel",
    code: "**61*",
    suffix: "**11*15#",
    format: "e164",
    cancelCode: "##61#",
    note: "This is the GSM-standard no-answer forwarding code. Dial ##61# to turn forwarding off.",
  },
  jio: {
    label: "Jio",
    code: "**61*",
    suffix: "**11*15#",
    format: "e164",
    cancelCode: "##61#",
    note: "This is the GSM-standard no-answer forwarding code. Dial ##61# to turn forwarding off.",
  },
  vi: {
    label: "Vi",
    code: "**61*",
    suffix: "**11*15#",
    format: "e164",
    cancelCode: "##61#",
    note: "This is the GSM-standard no-answer forwarding code. Dial ##61# to turn forwarding off.",
  },
};

/** Unknown carrier values (e.g. stored rows from older versions) fall back to
 * the GSM-standard code, which is the most portable default. */
function normalizeCarrier(carrier: Carrier | string): Carrier {
  return (CARRIERS as readonly string[]).includes(carrier)
    ? (carrier as Carrier)
    : "other";
}

/** The destination number spelled exactly as the carrier expects it between
 * the code and the suffix (no spaces — this is what gets dialed). */
export function destinationDigits(
  carrier: Carrier | string,
  destination: string
): string {
  const spec = SPECS[normalizeCarrier(carrier)];
  const digits = destination.replace(/\D/g, "");
  if (spec.format === "e164") return `+${digits}`;
  const last10 = digits.slice(-10);
  return spec.format === "onePlus10" ? `1${last10}` : last10;
}

export interface CarrierForwarding {
  /** Carrier display name. */
  label: string;
  /** Star/MMI prefix dialed before the number (e.g. "*71", "**61*"). */
  code: string;
  /** Destination number as the carrier expects it (no spaces). */
  number: string;
  /** Human-readable grouping of `number` for display. */
  numberDisplay: string;
  /** Closing MMI segment after the number ("" or "**11*15#"). */
  suffix: string;
  /** The complete string to dial: code + number + suffix. */
  dialString: string;
  /** Code that turns the forwarding off again. */
  cancelCode: string;
  /** Carrier-specific caveats / fallback guidance. */
  note: string;
  /** Ring time before the no-answer forward kicks in. */
  ringSeconds: number;
}

/** Everything the UI needs to render the carrier-specific instruction. */
export function carrierForwarding(
  carrier: Carrier | string,
  destination: string
): CarrierForwarding {
  const spec = SPECS[normalizeCarrier(carrier)];
  const number = destinationDigits(carrier, destination);
  const digits = number.replace(/\D/g, "");

  let numberDisplay: string;
  if (spec.format === "e164") {
    numberDisplay =
      digits.length === 11 && digits.startsWith("1")
        ? `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
        : `+${digits}`;
  } else if (spec.format === "onePlus10") {
    numberDisplay = `1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  } else {
    numberDisplay = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }

  return {
    label: spec.label,
    code: spec.code,
    number,
    numberDisplay,
    suffix: spec.suffix,
    dialString: spec.code + number + spec.suffix,
    cancelCode: spec.cancelCode,
    note: spec.note,
    ringSeconds: RING_SECONDS,
  };
}

/**
 * The simple setup instruction shown to the plumber:
 *   "To enable AI after-hours backup, please dial this code on your phone:
 *    <code> followed by our number: <number>. This will forward unanswered
 *    calls to our AI after 15 seconds."
 * GSM carriers need the closing MMI segment, which the sentence calls out.
 */
export function generateSetupInstruction(
  carrier: Carrier | string,
  destination: string
): string {
  const fwd = carrierForwarding(carrier, destination);
  const lead =
    "To enable AI after-hours backup, please dial this code on your phone:";
  const tail = `This will forward unanswered calls to our AI after ${fwd.ringSeconds} seconds.`;
  if (fwd.suffix) {
    return `${lead} ${fwd.code} followed by our number: ${fwd.numberDisplay}, then finish with ${fwd.suffix}. ${tail}`;
  }
  return `${lead} ${fwd.code} followed by our number: ${fwd.numberDisplay}. ${tail}`;
}

/**
 * tel: link that opens the phone's dialer with the full sequence pre-filled.
 * `*`, `#`, and `%` are percent-encoded: a raw `#` would be parsed as a URL
 * fragment and truncate the MMI sequence mid-dial, and iOS/Android dialers
 * decode the percent-escaped forms before dialing.
 */
export function telHref(
  carrier: Carrier | string,
  destination: string
): string {
  const dialString = carrierForwarding(carrier, destination).dialString;
  const encoded = dialString.replace(
    /[*#%]/g,
    (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase()
  );
  return `tel:${encoded}`;
}

/**
 * E.164 → "+1 (928) 331-9394" for US numbers; the raw value otherwise.
 * The one display formatter for Callflow numbers (moved here when the old
 * /setup wizard was replaced by the linear /onboarding flow).
 */
export function formatUsNumber(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (match) return `+1 (${match[1]}) ${match[2]}-${match[3]}`;
  return e164;
}