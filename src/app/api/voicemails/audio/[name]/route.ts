import { NextRequest, NextResponse } from "next/server";

const EXPRESS_API = process.env.EXPRESS_API || "http://127.0.0.1:4001";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ name: string }> }
) {
  const { name } = await context.params;
  if (!/^[a-zA-Z0-9_-]+\.(mp3|wav|ogg|m4a)$/.test(name)) {
    return new NextResponse("Bad request", { status: 400 });
  }
  try {
    const res = await fetch(`${EXPRESS_API}/voicemails/${name}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return new NextResponse("Not found", { status: 404 });
    }
    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": res.headers.get("content-type") || "audio/mpeg",
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Backend unreachable", { status: 502 });
  }
}
