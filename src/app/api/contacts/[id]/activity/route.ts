import { NextResponse } from "next/server";
import { getActivityLogsByContact } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const logs = await getActivityLogsByContact(id);
  return NextResponse.json(logs);
}
