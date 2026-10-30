import { NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { applyDodoWebhookEvent, getBusinessById } from "@/lib/db";
import { normalizeDodoEvent } from "@/lib/dodo-events";
import { assignNumber } from "@/lib/numbers-pool";
import { getDodoWebhookSecret } from "@/lib/dodo";

export const runtime = "nodejs";

/**
 * Inbound Dodo Payments webhook — the only writer of `subscriptionStatus`, and
 * therefore the only thing that grants trial or paid access.
 *
 * Verification uses the `standardwebhooks` package (what Dodo's SDK
 * `webhooks.unwrap()` calls internally) against the exact bytes received:
 * Next.js route handlers expose `request.text()`, so no raw-body middleware is
 * needed and nothing is re-serialized.
 *
 * Dodo retries any delivery we do not answer with 2xx, so the two rules here are
 * (1) always acknowledge events we deliberately ignore, and (2) return a 5xx
 * when our own write fails, so the retry redelivers rather than losing the event.
 * The idempotency claim and the fulfillment commit in one transaction
 * (`applyDodoWebhookEvent`), which is what makes the retry safe.
 */
export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getDodoWebhookSecret();
  } catch {
    console.error("[dodo-webhook] DODO_PAYMENTS_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { error: "Webhook endpoint is not configured" },
      { status: process.env.NODE_ENV === "production" ? 503 : 400 }
    );
  }

  const webhookId = request.headers.get("webhook-id");
  const webhookSignature = request.headers.get("webhook-signature");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  if (!webhookId || !webhookSignature || !webhookTimestamp) {
    return NextResponse.json({ error: "Missing webhook signature headers" }, { status: 401 });
  }

  const rawBody = await request.text();
  let event: unknown;
  try {
    event = new Webhook(secret).verify(rawBody, {
      "webhook-id": webhookId,
      "webhook-signature": webhookSignature,
      "webhook-timestamp": webhookTimestamp,
    });
  } catch (error) {
    console.warn("[dodo-webhook] invalid signature", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  const normalized = normalizeDodoEvent(event);

  if (!normalized.relevant) {
    // Subscribed-but-unused events (refunds, payouts, disputes, …) still need a
    // 2xx, otherwise Dodo keeps retrying them.
    return NextResponse.json({ ok: true, ignored: normalized.eventType });
  }

  let result: { accepted: boolean; businessId: string | null };
  try {
    result = await applyDodoWebhookEvent({
      webhookId,
      eventType: normalized.eventType,
      businessHint: normalized.businessHint,
      customerId: normalized.customerId,
      subscriptionId: normalized.subscriptionId,
      subscriptionStatus: normalized.subscriptionStatus,
      paymentId: normalized.paymentId,
      // Dodo's own trial starts when the subscription is created, so mirror it
      // here rather than at checkout-session creation time.
      startTrialAt:
        normalized.eventType === "subscription.active" ? new Date().toISOString() : null,
    });
  } catch (error) {
    console.error("[dodo-webhook] failed to persist event", {
      eventType: normalized.eventType,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Webhook persistence failed" },
      { status: process.env.NODE_ENV === "production" ? 503 : 500 }
    );
  }

  if (!result.accepted) {
    console.info("[dodo-webhook] duplicate delivery skipped", {
      webhookId,
      eventType: normalized.eventType,
    });
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (result.businessId) {
    console.info("[dodo-webhook] applied", {
      eventType: normalized.eventType,
      businessId: result.businessId,
      subscriptionId: normalized.subscriptionId,
      status: normalized.subscriptionStatus,
    });

    // Auto-assign pool number on first activation if not already assigned.
    if (normalized.eventType === "subscription.active") {
      const business = await getBusinessById(result.businessId);
      if (business && !business.assignedNumber) {
        const poolResult = await assignNumber(result.businessId, business.phoneNumber);
        if (poolResult.pending) {
          console.error("[dodo-webhook] pool empty — no number assigned to", result.businessId);
        } else {
          console.info("[dodo-webhook] pool number assigned", {
            businessId: result.businessId,
            assignedNumber: poolResult.assignedNumber,
          });
        }
      }
    }
  } else {
    console.warn("[dodo-webhook] no Callflow business matched this event", {
      eventType: normalized.eventType,
      customerId: normalized.customerId,
      subscriptionId: normalized.subscriptionId,
    });
  }

  return NextResponse.json({ ok: true });
}