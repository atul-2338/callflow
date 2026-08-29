import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateSignalWireConfig } from "./signalwire";

const ENV_VARS = [
  "SIGNALWIRE_PROJECT_ID",
  "SIGNALWIRE_API_TOKEN",
  "SIGNALWIRE_SPACE_URL",
  "SIGNALWIRE_FROM_NUMBER",
];

describe("validateSignalWireConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of ENV_VARS) delete process.env[key];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports placeholders as invalid", () => {
    process.env.SIGNALWIRE_PROJECT_ID = "PASTE_YOUR_PROJECT_ID";
    process.env.SIGNALWIRE_API_TOKEN = "PASTE_YOUR_API_TOKEN";
    process.env.SIGNALWIRE_SPACE_URL = "https://your-space.signalwire.com";
    process.env.SIGNALWIRE_FROM_NUMBER = "+1xxx";

    const result = validateSignalWireConfig();
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports missing values as invalid", () => {
    const result = validateSignalWireConfig();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("SIGNALWIRE_PROJECT_ID"))).toBe(true);
  });

  it("accepts a valid configuration", () => {
    process.env.SIGNALWIRE_PROJECT_ID = "some-project-id";
    process.env.SIGNALWIRE_API_TOKEN = "PT-token-123";
    process.env.SIGNALWIRE_SPACE_URL = "https://my-space.signalwire.com";
    process.env.SIGNALWIRE_FROM_NUMBER = "+18884956970";

    const result = validateSignalWireConfig();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
