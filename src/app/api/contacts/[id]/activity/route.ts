import { NextResponse } from "next/server";
import { getActivityLogsByContact } from "@/lib/db";
import { businessIdFromCookieHeader } from "@/lib/business-session";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (!businessId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const logs = await getActivityLogsByContact(id);
  return NextResponse.json(logs);
}
