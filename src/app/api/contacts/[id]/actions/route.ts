import { NextResponse } from "next/server";
import { addActivityLog, getContactById, getSettings } from "@/lib/db";
import { isSmsConfigured, sendOutboundSms } from "@/lib/sms";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";
import { formatTemplate } from "@/lib/util";

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
      action: "log-call" | "send-sms";
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

    const settings = await getSettings();
    const template = message || settings.missedCallReplyTemplate;
    const smsBody = formatTemplate(template, {
      name: contact.name,
      phone: contact.phone,
    });

    if (action === "send-sms") {
      if (!isSmsConfigured()) {
        return NextResponse.json(
          { error: "SMS is not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_API_TOKEN, SIGNALWIRE_SPACE_URL, and SIGNALWIRE_FROM_NUMBER in .env.local." },
          { status: 400 }
        );
      }
      const result = await sendOutboundSms(contact.phone, smsBody);
      await addActivityLog({
        contactId: id,
        type: "sms",
        message: `SMS (${result.provider}) sent: ${smsBody}`,
      });
      return NextResponse.json({ success: true, sid: result.sid, provider: result.provider });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Action failed";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
