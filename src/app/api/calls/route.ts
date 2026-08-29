import { NextResponse } from "next/server";
import { getCalls } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const since = searchParams.get("since");

  const calls = await getCalls();
  const filtered = calls.filter((call) => {
    if (status && call.callStatus !== status) return false;
    if (since && call.callStartedAt < since) return false;
    return true;
  });

  return NextResponse.json(filtered);
}
