import { NextResponse } from "next/server";
import { getClientProfile, saveClientProfile } from "@/lib/db";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";
import { isValidPhone } from "@/lib/util";

export async function GET() {
  const profile = await getClientProfile();
  return NextResponse.json(profile);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const { name, phone, address, email } = body;

    if (!name?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { error: "Name and phone are required" },
        { status: 400 }
      );
    }

    if (!isValidPhone(phone)) {
      return NextResponse.json(
        { error: "Phone number must be at least 10 digits" },
        { status: 400 }
      );
    }

    const profile = await saveClientProfile({
      name: name.trim(),
      phone: phone.trim(),
      address: address?.trim() || "",
      email: email?.trim() || "",
    });

    return NextResponse.json(profile, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to save client profile" }, { status: 500 });
  }
}
