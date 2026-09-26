import { NextResponse } from "next/server";
import { addWaitlistSignup } from "@/lib/db";

/**
 * Landing-page waitlist signup (Phase 6 tester acquisition). Idempotent per
 * email — a repeat signup returns the existing row with `created: false`.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "landing";
  const { signup, created } = await addWaitlistSignup(email, source);

  return NextResponse.json(
    { success: true, created, email: signup.email },
    { status: created ? 201 : 200 }
  );
}
