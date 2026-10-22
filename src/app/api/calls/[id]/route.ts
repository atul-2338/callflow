import { NextResponse } from "next/server";
import { getCallById, setCallFollowUp } from "@/lib/db";
import {
  resolveCallAccess,
  unauthorizedCallResponse,
} from "@/lib/call-access";
import { FOLLOW_UP_STATUSES, type FollowUpStatus } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_NOTES_CHARS = 2000;

/**
 * Owner follow-up workflow on a single call:
 * `PATCH { followUpStatus?: "needed" | "resolved" | "none", followUpNotes?: string }`
 *
 * - Session callers may only touch calls that belong to their business; a
 *   foreign or unknown id answers 404 (no existence leak).
 * - Every field is validated; there is no partial-blob write path.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const access = resolveCallAccess(request);
  if (!access.authorized) return unauthorizedCallResponse();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const rawStatus =
    typeof body.followUpStatus === "string" ? body.followUpStatus : null;
  const notes = typeof body.followUpNotes === "string" ? body.followUpNotes : null;

  if (rawStatus === null && notes === null) {
    return NextResponse.json(
      { error: "Provide followUpStatus and/or followUpNotes." },
      { status: 400 }
    );
  }
  if (
    rawStatus !== null &&
    !(FOLLOW_UP_STATUSES as readonly string[]).includes(rawStatus)
  ) {
    return NextResponse.json(
      {
        error: `followUpStatus must be one of: ${FOLLOW_UP_STATUSES.join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (notes !== null && notes.length > MAX_NOTES_CHARS) {
    return NextResponse.json(
      { error: `followUpNotes must be at most ${MAX_NOTES_CHARS} characters.` },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  const existing = await getCallById(id);
  if (!existing) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }
  if (access.businessId && existing.businessId !== access.businessId) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  const call = await setCallFollowUp(id, {
    status:
      (rawStatus as FollowUpStatus | null) ?? existing.followUpStatus,
    notes: notes !== null ? notes : undefined,
  });
  if (!call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }
  return NextResponse.json(call);
}