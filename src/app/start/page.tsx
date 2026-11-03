import type { Metadata } from "next";
import Link from "next/link";

import StartForm from "@/components/leads/StartForm";

export const metadata: Metadata = {
  title: "Get CallFlow — never miss another lead",
  description:
    "Leave your name, number and email and we will call you back to set up CallFlow for your business.",
  robots: { index: false, follow: false },
};

/**
 * Public post-demo lead intake page.
 *
 * The founder shares this link (https://<host>/start) with a prospect right
 * after a demo call; the submission goes to POST /api/leads, which saves one
 * `leads` row and emails the operator, and the lead then shows up in the admin
 * panel's Leads tab (/admin/leads).
 *
 * Open to everyone — no session, no gate: it is the first thing a prospect ever
 * touches. Same iOS-light styling as /login, deliberately stripped of the app
 * navigation.
 */
export default function StartPage() {
  return (
    <div className="min-h-screen bg-[#f2f2f7] text-ink">
      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-10 sm:pt-16">
        <Link href="/" className="text-sm font-medium text-ink-2 hover:text-ink">
          CallFlow
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Let&apos;s get you set up
        </h1>
        <p className="mt-1.5 text-sm text-ink-2">
          CallFlow answers the calls you miss, takes the message and books the
          job. Leave your details and we&apos;ll call you back to set it up —
          your own number stays exactly as it is.
        </p>

        <StartForm />

        <p className="mt-6 text-sm text-ink-3">
          Already a customer?{" "}
          <Link href="/login" className="font-medium text-ink-2 underline">
            Log in
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
