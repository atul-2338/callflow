import { cookies } from "next/headers";
import SettingsPanel from "@/components/settings/SettingsPanel";
import {
  businessSessionCookieName,
  verifyBusinessSessionToken,
} from "@/lib/business-session";
import { getBusinessById } from "@/lib/db";

export const metadata = { title: "Settings — CallFlow" };

/**
 * Resolves the signed-in business so the panel shows THIS business's assigned
 * CallFlow number — the number missed calls forward to and the one the Dograh
 * webhook matches incoming calls on — instead of a hard-coded value, plus the
 * business's permanent client UID ("TE-…") for support conversations.
 */
export default async function SettingsPage() {
  const cookieStore = await cookies();
  const businessId = verifyBusinessSessionToken(
    cookieStore.get(businessSessionCookieName())?.value
  );
  const business = businessId ? await getBusinessById(businessId) : undefined;
  return (
    <SettingsPanel
      forwardTo={business?.phoneNumber ?? null}
      clientUid={business?.clientUid ?? null}
    />
  );
}