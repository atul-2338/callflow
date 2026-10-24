import { NextResponse } from "next/server";

/**
 * Liveness probe for the Dograh webhook (GET, no secret required). Use it to
 * verify reachability from the Dograh editor or a tunnel without firing a
 * call event. The webhook itself answers GET with 405 (POST-only by design).
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}