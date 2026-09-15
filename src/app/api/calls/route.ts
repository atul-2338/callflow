import { NextResponse } from "next/server";
import { getCalls } from "@/lib/db";
import { CALL_OUTCOMES } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const since = searchParams.get("since");
  const outcome = searchParams.get("outcome");

  if (outcome && !(CALL_OUTCOMES as readonly string[]).includes(outcome)) {
    return NextResponse.json(
      { error: `Unknown outcome: ${outcome}` },
      { status: 400 }
    );
  }

  const calls = await getCalls();
  const filtered = calls.filter((call) => {
    if (status && call.callStatus !== status) return false;
    if (since && call.callStartedAt < since) return false;
    if (outcome && (call.outcome ?? "other") !== outcome) return false;
    return true;
  });

  return NextResponse.json(filtered);
}
