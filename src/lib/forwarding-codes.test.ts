import { describe, expect, it } from "vitest";
import {
  carrierForwarding,
  destinationDigits,
  generateSetupInstruction,
  RING_SECONDS,
  telHref,
} from "./forwarding-codes";

// The CallFlow-assigned number the plumber's phone forwards to.
const DEST = "+19283319394";

describe("carrierForwarding", () => {
  it("uses Verizon's official *71 code with the bare 10-digit number", () => {
    const fwd = carrierForwarding("verizon", DEST);
    expect(fwd.label).toBe("Verizon");
    expect(fwd.code).toBe("*71");
    expect(fwd.number).toBe("9283319394");
    expect(fwd.numberDisplay).toBe("928 331 9394");
    expect(fwd.suffix).toBe("");
    expect(fwd.dialString).toBe("*719283319394");
    expect(fwd.cancelCode).toBe("*73");
    expect(fwd.ringSeconds).toBe(RING_SECONDS);
  });

  it.each(["att", "tmobile", "other"] as const)(
    "uses the GSM no-answer code with a 15s timer for %s",
    (carrier) => {
      const fwd = carrierForwarding(carrier, DEST);
      expect(fwd.code).toBe("**61*");
      expect(fwd.number).toBe("19283319394");
      expect(fwd.numberDisplay).toBe("1 928 331 9394");
      expect(fwd.suffix).toBe("**11*15#");
      expect(fwd.dialString).toBe("**61*19283319394**11*15#");
      expect(fwd.cancelCode).toBe("##61#");
      expect(fwd.ringSeconds).toBe(RING_SECONDS);
    }
  );

  it("uses the E.164 destination format for the legacy Indian carriers", () => {
    const fwd = carrierForwarding("jio", DEST);
    expect(fwd.number).toBe("+19283319394");
    expect(fwd.numberDisplay).toBe("+1 928 331 9394");
    expect(fwd.dialString).toBe("**61*+19283319394**11*15#");
  });

  it("falls back to the portable GSM code for unknown carrier values", () => {
    expect(carrierForwarding("nonsense", DEST).dialString).toBe(
      "**61*19283319394**11*15#"
    );
  });

  it("tolerates destinations without the + prefix", () => {
    expect(carrierForwarding("verizon", "9283319394").dialString).toBe(
      "*719283319394"
    );
    expect(carrierForwarding("att", "9283319394").dialString).toBe(
      "**61*19283319394**11*15#"
    );
  });

  it("keeps the full country code for non-US destinations", () => {
    expect(destinationDigits("airtel", "+447911123456")).toBe("+447911123456");
    // US carriers dial only the last 10 digits — best-effort for international
    // destinations (true international forwarding may need the carrier's own
    // international-dial feature; CallFlow's AI backup is US-first).
    expect(destinationDigits("verizon", "+447911123456")).toBe("7911123456");
    expect(destinationDigits("att", "+447911123456")).toBe("17911123456");
  });
});

describe("generateSetupInstruction", () => {
  it("follows the template: code, our number, 15-second promise (Verizon)", () => {
    expect(generateSetupInstruction("verizon", DEST)).toBe(
      "To enable AI after-hours backup, please dial this code on your phone: *71 followed by our number: 928 331 9394. This will forward unanswered calls to our AI after 15 seconds."
    );
  });

  it.each(["att", "tmobile", "other"] as const)(
    "appends the closing MMI segment for %s",
    (carrier) => {
      expect(generateSetupInstruction(carrier, DEST)).toBe(
        "To enable AI after-hours backup, please dial this code on your phone: **61* followed by our number: 1 928 331 9394, then finish with **11*15#. This will forward unanswered calls to our AI after 15 seconds."
      );
    }
  );
});

describe("telHref", () => {
  it("builds a tel: link from the full dial string", () => {
    expect(telHref("verizon", DEST)).toBe("tel:%2A719283319394");
    expect(telHref("att", DEST)).toBe(
      "tel:%2A%2A61%2A19283319394%2A%2A11%2A15%23"
    );
  });
});