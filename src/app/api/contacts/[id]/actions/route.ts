import { NextResponse } from "next/server";
import { addActivityLog, getContactById } from "@/lib/db";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: Request,
  context: RouteContext
) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const { id } = await context.params;
    const contact = await getContactById(id);

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const body = await request.json();
    const { action, message } = body as {
      action: "log-call";
      message?: string;
    };

    if (action === "log-call") {
      await addActivityLog({
        contactId: id,
        type: "call",
        message: message || "Manual call logged",
      });
      return NextResponse.json({ success: true, message: "Call logged successfully" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Action failed";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
