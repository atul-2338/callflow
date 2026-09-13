import { NextResponse } from "next/server";
import { normalizeEnvValue } from "./util";

// Comma-separated list of allowed origins, or "*" to allow any origin.
// Used by the onboarding endpoints so a separate frontend can call them.
export function getAllowedOrigins(): string[] {
  const raw = normalizeEnvValue(process.env.CORS_ORIGINS);
  if (!raw || raw === "*") return ["*"];
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(request?: Request): Record<string, string> {
  const origins = getAllowedOrigins();
  const origin = request?.headers.get("origin") || "";
  const allowOrigin =
    origins.includes("*") || (origin && origins.includes(origin))
      ? origin || "*"
      : origins[0] || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Token",
    "Access-Control-Max-Age": "86400",
  };
}

export function applyCors(
  response: NextResponse,
  request: Request
): NextResponse {
  const headers = corsHeaders(request);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export function handlePreflight(request: Request): NextResponse | null {
  if (request.method !== "OPTIONS") return null;
  return applyCors(new NextResponse(null, { status: 204 }), request);
}

// Explicit OPTIONS handler for route files that need CORS preflight.
// Next.js App Router dispatches OPTIONS itself, so a route must export an
// OPTIONS function to return CORS headers for the browser's preflight request.
export function corsPreflightResponse(request: Request): NextResponse {
  return applyCors(new NextResponse(null, { status: 204 }), request);
}
