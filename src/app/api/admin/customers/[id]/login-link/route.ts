/**
 * POST /api/admin/customers/[id]/login-link — mint a fresh one-time owner login
 * link for an existing customer ("Copy new login link").
 *
 * Guarded like every /api/admin/* route. The response carries the link, shown
 * and copied on screen only: the audit trail records the target and the expiry,
 * never the link or its token. Re-minting leaves previously issued, unexpired
 * links working (each token row is independent).
 */
import { NextResponse } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { createOwnerLoginLink, requestOrigin } from "@/lib/admin-customers";
import { requireAdminApi } from "@/lib/admin-session";
import { getBusinessById } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  const guard = requireAdminApi(request);
  if (guard) return guard;

  const { id } = await context.params;
  const business = await getBusinessById(id);
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const { url, expiresAt } = createOwnerLoginLink(id, requestOrigin(request));
  logAdminAction({
    action: "customer_login_link_created",
    target: id,
    details: { clientUid: business.clientUid, expiresAt },
    ip: clientIp(request),
  });

  return NextResponse.json({ loginUrl: url, expiresAt });
}
