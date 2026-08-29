import { NextResponse } from "next/server";
import { normalizeEnvValue } from "./util";

export function getExpectedAuthToken(): string {
  return normalizeEnvValue(process.env.APP_AUTH_TOKEN);
}

export function isAuthorized(request: Request): boolean {
  const expected = getExpectedAuthToken();
  if (!expected) return true;

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return false;
  return authHeader.slice(7).trim() === expected;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
