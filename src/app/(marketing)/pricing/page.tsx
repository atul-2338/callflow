import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";

export const metadata = {
  title: "Pricing — Solo plan, $49/month · CallFlow",
  description:
    "CallFlow Solo is one plan at $49 per month with a 3-day free trial. $0 due at signup, no setup fee, cancel anytime.",
};

const included = [
  {
    title: "24/7 AI receptionist",
    text: "Answers every missed call in your business name, day or night, including weekends and holidays.",
  },
  {
    title: "Full call transcripts",
    text: "Every call is written up and saved to your account, so you can see who called and what they needed.",
  },
  {
    title: "Message taking and FAQs",
    text: "Captures name, number, and reason for calling, and answers the common questions you pre-set.",
  },
  {
    title: "Appointment booking",
    text: "Books the caller into an open slot and hands you a confirmed request instead of a sticky note.",
  },
  {
    title: "Instant push notifications",
    text: "A notification hits your phone the moment a call ends, with the transcript one tap away.",
  },
  {
    title: "Your own dedicated number",
    text: "A US number we provision for your business and forward your missed calls to.",
  },
];

const billingFacts = [
  { label: "Price", value: "$49 / month" },
  { label: "Due at signup", value: "$0.00" },
  { label: "Free trial", value: "3 days" },
  { label: "Setup or hidden fees", value: "None" },
  { label: "Contract length", value: "None — month to month" },
  { label: "Billing date", value: "Day 4, then every month" },
];

export default function PricingPage() {
  return (
    <main>
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-14 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold">
          Pricing
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          One plan. Solo. $49 a month.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-white/75">
          Solo is the only plan CallFlow offers, and it includes everything:
          the AI receptionist, transcripts, appointment booking, push
          notifications, and your dedicated number. Start with a 3-day free
          trial — you pay <b className="text-foreground">$0 at signup</b>, and
          you are charged $49 only if you keep going past day 3.
        </p>
      </section>

      <PlanGrid />

      <SiteFooter />
    </main>
  );
}

function PlanGrid() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="ios-card p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-lg font-semibold text-ink">CallFlow Solo</p>
            <span className="rounded-full bg-booked/10 px-3 py-1 text-xs font-semibold text-booked">
              3-day free trial
            </span>
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-5xl font-bold tracking-tight text-ink">
              $0
            </span>
            <span className="text-sm text-ink-2">due today</span>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            then <b className="text-ink">$49 / month</b> · cancel anytime
          </p>

          <ul className="mt-6 space-y-3">
            {included.map((f) => (
              <li key={f.title} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-booked" />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {f.title}
                  </span>
                  <span className="block text-sm leading-relaxed text-ink-2">
                    {f.text}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <BillingColumn />
      </div>
    </section>
  );
}

function BillingColumn() {
  return (
    <div className="space-y-5">
      <div className="ios-card p-6">
        <h2 className="text-base font-semibold text-ink">
          How the trial and billing work
        </h2>
        <dl className="mt-4 space-y-3">
          {billingFacts.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-4 border-b border-separator pb-3 last:border-0 last:pb-0"
            >
              <dt className="text-sm text-ink-3">{row.label}</dt>
              <dd className="text-sm font-semibold text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
        <ol className="mt-5 space-y-2 text-sm leading-relaxed text-ink-2">
          <li>
            <b className="text-ink">1.</b> Sign up and finish setup — nothing is
            billed today.
          </li>
          <li>
            <b className="text-ink">2.</b> Your first 3 days are free. Cancel any
            time in that window and you are never charged.
          </li>
          <li>
            <b className="text-ink">3.</b> After day 3, $49 is billed monthly
            until you cancel.
          </li>
        </ol>
        <p className="mt-4 text-xs leading-relaxed text-ink-3">
          Payments are processed by our payment provider, Dodo Payments. CallFlow
          never stores your full card number. Cancellation stops all future
          charges; you keep access through the end of any period you already paid
          for. See our{" "}
          <Link
            href="/refund-policy"
            className="font-medium text-wire underline underline-offset-2"
          >
            refund policy
          </Link>
          .
        </p>
      </div>

      <div className="ios-card p-6">
        <h2 className="text-base font-semibold text-ink">
          No add-ons to figure out
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          There is no per-minute metering on your plan fee and no charge to point
          a second business line at the same account. One business, one price,
          one bill.
        </p>
        <Link
          href="/onboarding"
          className="ios-pill-primary mt-5 w-full px-4 py-3 text-[15px]"
        >
          Start your 3-day free trial
          <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="mt-3 text-center text-xs text-ink-3">
          $0 due at signup · cancel anytime before day 3
        </p>
      </div>

      <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-6">
        <h2 className="text-sm font-semibold text-foreground">
          Questions about pricing or a charge?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/65">
          Email{" "}
          <Link
            href="mailto:atul@callflow.biz"
            className="font-medium text-gold underline underline-offset-2"
          >
            atul@callflow.biz
          </Link>{" "}
          and we will get back to you within one business day.
        </p>
      </div>
    </div>
  );
}
