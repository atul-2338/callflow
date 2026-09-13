import { NextResponse } from "next/server";

const EXPRESS_API = process.env.EXPRESS_API || "http://127.0.0.1:4001";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${EXPRESS_API}/browser-phone`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.error || `Backend ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backend unreachable" },
      { status: 502 }
    );
  }
}
