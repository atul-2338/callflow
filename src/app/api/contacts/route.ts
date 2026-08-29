import { NextResponse } from "next/server";
import { createContact, deleteContact, getContacts, updateContact } from "@/lib/db";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";
import { isValidPhone } from "@/lib/util";
import { CONTACT_STATUSES } from "@/lib/types";

export async function GET() {
  const contacts = await getContacts();
  return NextResponse.json(contacts);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const { name, phone, email, status, notes } = body;

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

    const contactStatus = CONTACT_STATUSES.includes(status) ? status : "New";

    const contact = await createContact({
      name: name.trim(),
      phone: phone.trim(),
      email: email?.trim() || "",
      status: contactStatus,
      notes: notes?.trim() || "",
    });

    return NextResponse.json(contact, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create contact" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const { id, name, phone, email, status, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "Contact ID is required" }, { status: 400 });
    }

    if (phone !== undefined && phone.trim() && !isValidPhone(phone)) {
      return NextResponse.json(
        { error: "Phone number must be at least 10 digits" },
        { status: 400 }
      );
    }

    const contactStatus =
      status && CONTACT_STATUSES.includes(status) ? status : undefined;

    const updated = await updateContact(id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(phone !== undefined && { phone: phone.trim() }),
      ...(email !== undefined && { email: email.trim() }),
      ...(contactStatus && { status: contactStatus }),
      ...(notes !== undefined && { notes: notes.trim() }),
    });

    if (!updated) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Failed to update contact" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Contact ID is required" }, { status: 400 });
    }

    const deleted = await deleteContact(id);
    if (!deleted) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete contact" }, { status: 500 });
  }
}
