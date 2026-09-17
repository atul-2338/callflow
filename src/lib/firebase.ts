import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import type { ServiceAccount } from "firebase-admin/app";
import { normalizeEnvValue } from "./util";

function getServiceAccount(): ServiceAccount | null {
  const raw = normalizeEnvValue(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (!raw) return null;

  // FIREBASE_SERVICE_ACCOUNT is expected to be a single-line JSON string.
  // Also accept a base64-encoded JSON string for easier .env.local handling.
  const decode = (value: string): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      try {
        return JSON.parse(Buffer.from(value, "base64").toString("utf-8"));
      } catch {
        return null;
      }
    }
  };

  const parsed = decode(raw) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  } | null;

  if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) {
    return null;
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

let initialized = false;

function getFirebaseApp() {
  if (!initialized) {
    const serviceAccount = getServiceAccount();
    if (serviceAccount) {
      try {
        initializeApp({ credential: cert(serviceAccount) });
        initialized = true;
      } catch (err) {
        console.error(
          "[Firebase] Failed to initialize (check FIREBASE_SERVICE_ACCOUNT):",
          err instanceof Error ? err.message : err
        );
      }
    }
  }
  return initialized && getApps().length > 0 ? getApps()[0] : null;
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseApp() !== null;
}

export interface NotifyMissedCallResult {
  sent: boolean;
  messageId?: string;
  error?: string;
  /** True when FCM rejected the token itself — the device uninstalled the
   * app or the token was rotated. The stored token is permanently dead and
   * the caller should clear it (see clearBusinessFcmToken). */
  invalidToken?: boolean;
}

/** FCM HTTP v1 error codes that mean the registration token will never work
 * again (firebase-admin wraps them on the thrown FcmError as `.code`). The
 * legacy_* spellings are kept because older error mappings surface them. */
const DEAD_FCM_TOKEN_CODES = new Set([
  "messaging/unregistered",
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export function isDeadFcmTokenError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && DEAD_FCM_TOKEN_CODES.has(code.toLowerCase());
}

export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<NotifyMissedCallResult> {
  if (!fcmToken) {
    return { sent: false, error: "No FCM token configured" };
  }

  const app = getFirebaseApp();
  if (!app) {
    return {
      sent: false,
      error: "Firebase is not configured — set FIREBASE_SERVICE_ACCOUNT in .env.local",
    };
  }

  try {
    const messageId = await getMessaging(app).send({
      token: fcmToken,
      notification: { title, body },
      data: data ?? {},
    });
    return { sent: true, messageId };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "FCM send failed",
      invalidToken: isDeadFcmTokenError(err),
    };
  }
}

export async function notifyMissedCall(
  fcmToken: string,
  callerNumber: string
): Promise<NotifyMissedCallResult> {
  return sendPushNotification(
    fcmToken,
    "Missed call",
    `You missed a call from ${callerNumber}`,
    { callerNumber }
  );
}
