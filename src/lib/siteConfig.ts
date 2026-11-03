/**
 * Site-wide demo configuration for the homepage "Hear it for yourself" section.
 *
 * Every value below is intentionally an empty string; the founder fills these
 * in when the demo line and sample audio exist. Each part of the section whose
 * value stays empty is not rendered at all.
 */

/** Display form of the demo phone number, e.g. "(555) 010-0000". */
export const DEMO_PHONE_DISPLAY: string = "";

/** Callable form of the demo phone number used in the tel: link, e.g. "+15550100000". */
export const DEMO_PHONE_TEL: string = "";

/** Public path to the sample-call audio file, e.g. "/demo/sample-call.mp3". */
export const DEMO_AUDIO_SRC: string = "";

/**
 * Public path to the ~20s homepage demo video (build brief step 7). Empty until
 * the founder drops the file in `public/` and sets the path here — the video
 * block is simply not rendered while this stays empty.
 */
export const DEMO_VIDEO_SRC: string = "";

/**
 * City landing pages (build brief step 7): each city shows its OWN demo phone
 * number. Fill `phoneDisplay` ("(912) 555-0100") and `phoneTel` ("+19125550100")
 * once the numbers exist; while they are empty the page says the demo line is
 * coming and still shows the single call-to-action + pricing line.
 */
export interface CityDemoLine {
  /** e.g. "Savannah" */
  city: string;
  /** e.g. "GA" */
  state: string;
  /** Human formatting of the demo number, or "" when not provisioned yet. */
  phoneDisplay: string;
  /** Diallable E.164 for the tel: link, or "" when not provisioned yet. */
  phoneTel: string;
}

export const CITY_DEMO_LINES: Record<string, CityDemoLine> = {
  savannah: { city: "Savannah", state: "GA", phoneDisplay: "", phoneTel: "" },
  austin: { city: "Austin", state: "TX", phoneDisplay: "", phoneTel: "" },
};
