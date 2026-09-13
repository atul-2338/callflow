import { NextRequest, NextResponse } from "next/server";

const EXPRESS_API = process.env.EXPRESS_API || "http://127.0.0.1:4001";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const to = String(form?.get("to") || "").trim();
  if (!to) {
    return NextResponse.json({ message: "Missing \"to\" number." }, { status: 400 });
  }
  try {
    const res = await fetch(`${EXPRESS_API}/dial`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ to }).toString(),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Backend unreachable" },
      { status: 502 }
    );
  }
}
