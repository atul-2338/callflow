/**
 * PATCH /api/admin/businesses/[id] — set (or clear) the business's assigned
 * CallFlow number from the admin panel's business detail page.
 *
 * Guarded like every /api/admin/* route (requireAdminApi first line). The
 * number must normalize to valid E.164 and must not collide with any OTHER
 * business's assignedNumber or phoneNumber (self is allowed, so a business can
 * re-save its own number); an empty value clears the assignment so the
 * business falls back to the shared CallFlow DID. Only
 * businesses.assignedNumber changes. Success is audit-logged (ids and the
 * business's own phone keys only — see the admin-audit contract).
 */
import { NextResponse } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminApi } from "@/lib/admin-session";
import { getAllBusinesses, getBusinessById, updateBusiness } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";
import { toE164InternationalPhone } from "@/lib/util";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  const guard = requireAdminApi(request);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  if (typeof body.assignedNumber !== "string") {
    return NextResponse.json(
      {
        error:
          "assignedNumber is required (string; send an empty string to clear the assignment).",
      },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  const business = await getBusinessById(id);
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const raw = body.assignedNumber.trim();

  // Empty value clears the assignment (null = use the shared CallFlow DID).
  if (!raw) {
    const cleared = await updateBusiness(id, { assignedNumber: null });
    logAdminAction({
      action: "business_assigned_number_set",
      target: id,
      details: {
        clientUid: business.clientUid,
        assignedNumber: null,
        previousAssignedNumber: business.assignedNumber,
      },
      ip: clientIp(request),
    });
    return NextResponse.json({ business: cleared });
  }

  let e164: string;
  try {
    e164 = toE164InternationalPhone(raw);
  } catch {
    return NextResponse.json(
      {
        error:
          "Assigned number must be a valid international number with country code (e.g. +1 555 123 4567).",
      },
      { status: 400 }
    );
  }

  // A number may belong to exactly one business: reject a collision with any
  // OTHER business's assignedNumber OR phoneNumber (self is allowed, so a
  // business can re-save its own number). Malformed legacy values cannot be
  // normalized, so they can never collide with a valid E.164 either.
  const all = await getAllBusinesses();
  const clash = all.find((other) => {
    if (other.id === id) return false;
    for (const candidate of [other.assignedNumber, other.phoneNumber]) {
      if (!candidate) continue;
      try {
        if (toE164InternationalPhone(candidate) === e164) return true;
      } catch {
        // Not a parsable number — skip it.
      }
    }
    return false;
  });
  if (clash) {
    return NextResponse.json(
      {
        error: `This number is already in use by another business (${
          clash.clientUid ?? clash.id
        }).`,
      },
      { status: 409 }
    );
  }

  const updated = await updateBusiness(id, { assignedNumber: e164 });
  logAdminAction({
    action: "business_assigned_number_set",
    target: id,
    details: {
      clientUid: business.clientUid,
      assignedNumber: e164,
      previousAssignedNumber: business.assignedNumber,
    },
    ip: clientIp(request),
  });
  return NextResponse.json({ business: updated });
}