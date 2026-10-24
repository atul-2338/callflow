import { NextResponse } from "next/server";
import { getDb } from "@/lib/database";

/**
 * Liveness probe for the Dograh webhook (GET, no secret required). Use it to
 * verify reachability from the Dograh editor or a tunnel without firing a
 * call event. The webhook itself answers GET with 405 (POST-only by design).
 *
 * The probe also runs one cheap read-only query so it doubles as the deploy
 * health gate's DB round-trip: a broken or unreadable database fails with 500
 * instead of silently reporting ok.
 */
export async function GET() {
  try {
    const row = getDb().prepare("SELECT COUNT(*) AS c FROM calls").get() as {
      c: number;
    };
    return NextResponse.json({ ok: true, calls: row.c });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "database unavailable",
      },
      { status: 500 }
    );
  }
}