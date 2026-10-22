import { NextResponse } from "next/server";
import { getCalls, getCallsForBusiness } from "@/lib/db";
import {
  resolveCallAccess,
  unauthorizedCallResponse,
} from "@/lib/call-access";
import {
  CALL_OUTCOMES,
  CALL_STATUSES,
  FOLLOW_UP_STATUSES,
} from "@/lib/types";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

/**
 * Recent calls for the dashboard.
 *
 * Auth: business session cookie (tenant-scoped) or `APP_AUTH_TOKEN` bearer.
 * When neither applies and `APP_AUTH_TOKEN` is unset (local dev), the route
 * stays open — the repo-wide convention; production sets the token.
 */
export async function GET(request: Request) {
  const access = resolveCallAccess(request);
  if (!access.authorized) return unauthorizedCallResponse();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const since = searchParams.get("since");
  const outcome = searchParams.get("outcome");
  const followUp = searchParams.get("followUp");
  const limitRaw = searchParams.get("limit");
  const limitNum = limitRaw === null ? NaN : Number(limitRaw);

  if (status && !(CALL_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: `Unknown status: ${status}` },
      { status: 400 }
    );
  }
  if (outcome && !(CALL_OUTCOMES as readonly string[]).includes(outcome)) {
    return NextResponse.json(
      { error: `Unknown outcome: ${outcome}` },
      { status: 400 }
    );
  }
  if (
    followUp &&
    !(FOLLOW_UP_STATUSES as readonly string[]).includes(followUp)
  ) {
    return NextResponse.json(
      { error: `Unknown followUp: ${followUp}` },
      { status: 400 }
    );
  }
  const limit =
    Number.isFinite(limitNum) && limitNum > 0
      ? Math.min(Math.floor(limitNum), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const calls = access.businessId
    ? await getCallsForBusiness(access.businessId)
    : await getCalls();
  const filtered = calls.filter((call) => {
    if (status && call.callStatus !== status) return false;
    if (since && call.callStartedAt < since) return false;
    if (outcome && (call.outcome ?? "other") !== outcome) return false;
    if (followUp && call.followUpStatus !== followUp) return false;
    return true;
  });

  return NextResponse.json(filtered.slice(0, limit));
}
