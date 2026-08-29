import { RestClient } from "@signalwire/compatibility-api";
import { normalizeEnvValue } from "./util";

export interface SignalWireConfig {
  projectId: string;
  apiToken: string;
  spaceUrl: string;
  fromNumber: string;
}

export interface SignalWireConfigValidation {
  valid: boolean;
  errors: string[];
}

export function getSignalWireConfig(): SignalWireConfig {
  return {
    projectId: normalizeEnvValue(process.env.SIGNALWIRE_PROJECT_ID),
    apiToken: normalizeEnvValue(process.env.SIGNALWIRE_API_TOKEN),
    spaceUrl: normalizeEnvValue(process.env.SIGNALWIRE_SPACE_URL),
    fromNumber: normalizeEnvValue(process.env.SIGNALWIRE_FROM_NUMBER),
  };
}

export function validateSignalWireConfig(): SignalWireConfigValidation {
  const { projectId, apiToken, spaceUrl, fromNumber } = getSignalWireConfig();
  const errors: string[] = [];

  if (!projectId) {
    errors.push("SIGNALWIRE_PROJECT_ID is missing from .env.local");
  } else if (projectId.includes("PASTE") || projectId.includes("YOUR_")) {
    errors.push(
      "SIGNALWIRE_PROJECT_ID is still a placeholder — paste your real SignalWire Project ID"
    );
  }

  if (!apiToken) {
    errors.push("SIGNALWIRE_API_TOKEN is missing from .env.local");
  } else if (apiToken.includes("PASTE") || apiToken.includes("YOUR_")) {
    errors.push(
      "SIGNALWIRE_API_TOKEN is still a placeholder — paste your real SignalWire API Token"
    );
  }

  if (!spaceUrl) {
    errors.push("SIGNALWIRE_SPACE_URL is missing from .env.local");
  } else if (!/^https:\/\/.+\.signalwire\.com$/.test(spaceUrl)) {
    errors.push(
      "SIGNALWIRE_SPACE_URL must be a full URL like https://your-space.signalwire.com"
    );
  }

  if (!fromNumber) {
    errors.push("SIGNALWIRE_FROM_NUMBER is missing from .env.local");
  } else if (fromNumber.includes("PASTE") || fromNumber.includes("YOUR_")) {
    errors.push(
      "SIGNALWIRE_FROM_NUMBER is still a placeholder — paste your real SignalWire number"
    );
  } else if (!/^\+[1-9]\d{6,14}$/.test(fromNumber)) {
    errors.push(
      "SIGNALWIRE_FROM_NUMBER must be in E.164 format, e.g. +1xxx (no brackets or spaces)"
    );
  }

  return { valid: errors.length === 0, errors };
}

export function isSignalWireConfigured(): boolean {
  return validateSignalWireConfig().valid;
}

export function createSignalWireClient() {
  const validation = validateSignalWireConfig();
  if (!validation.valid) {
    throw new Error(validation.errors.join("; "));
  }
  const { projectId, apiToken, spaceUrl } = getSignalWireConfig();
  // The SDK builds baseUrl as `https://${signalwireSpaceUrl}`, so it expects
  // a bare hostname (no scheme). Our env var stores the full URL.
  const host = spaceUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return RestClient(projectId, apiToken, { signalwireSpaceUrl: host });
}

export interface SendSmsResult {
  sid: string;
  provider: "signalwire";
}

export async function sendSms(to: string, body: string): Promise<SendSmsResult> {
  const { fromNumber } = getSignalWireConfig();
  const client = createSignalWireClient();
  const message = await client.messages.create({
    from: fromNumber,
    to,
    body,
  });
  return { sid: message.sid, provider: "signalwire" };
}
