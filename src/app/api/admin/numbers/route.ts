/**
 * POST /api/admin/numbers — add numbers to the pool from the admin panel.
 *
 * Guarded like every /api/admin/* route (requireAdminApi first line). The body
 * is `{ numbers: string }` — one number per line, each validated against the
 * strict US pool format (+1 + 10 digits). Duplicates (already in the pool or
 * already live on a business row) and invalid lines are skipped, never
 * written. Success is audit-logged with counts only.
 */
import { NextResponse } from "next/server";

import { addNumbers } from "@/lib/numbers-pool";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminApi } from "@/lib/admin-session";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
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

  const raw = typeof body.numbers === "string" ? body.numbers : "";
  if (!raw.trim()) {
    return NextResponse.json(
      { error: "numbers is required (one number per line)." },
      { status: 400 }
    );
  }

  const result = await addNumbers(raw);
  logAdminAction({
    action: "pool_numbers_added",
    target: null,
    details: {
      addedCount: result.added.length,
      skippedInvalidCount: result.skippedInvalid.length,
      skippedDuplicateCount: result.skippedDuplicate.length,
    },
    ip: clientIp(request),
  });

  return NextResponse.json(result);
}