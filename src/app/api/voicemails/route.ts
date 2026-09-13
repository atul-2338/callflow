import { NextResponse } from "next/server";

const EXPRESS_API = process.env.EXPRESS_API || "http://127.0.0.1:4001";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${EXPRESS_API}/voicemails.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Backend error ${res.status}` }, { status: 502 });
    }
    const rows = await res.json();
    const mapped = (rows || []).map((v: Record<string, unknown>) => ({
      id: v.id,
      from_number: v.from_number,
      to_number: v.to_number,
      recording_url: v.recording_url,
      recording_duration: v.recording_duration,
      transcript: v.transcript,
      customer_name: v.customer_name,
      customer_address: v.customer_address,
      technical_issue: v.technical_issue,
      created_at: v.created_at,
      local_recording_path: v.local_recording_path
        ? `/api/voicemails/audio/${String(v.local_recording_path).split("/").pop()}`
        : null,
    }));
    return NextResponse.json(mapped);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reach backend" },
      { status: 502 }
    );
  }
}
