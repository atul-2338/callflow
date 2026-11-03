import Link from "next/link";
import { ArrowRight, Phone } from "lucide-react";

import {
  SiteFooter,
  SiteHeader,
  SUPPORT_EMAIL,
} from "@/components/marketing/SiteChrome";
import { CITY_DEMO_LINES } from "@/lib/siteConfig";

/**
 * Shared body for the city landing pages (build brief step 7): /savannah and
 * /austin.
 *
 * One page = one city = one demo phone number = ONE call-to-action, plus the
 * pricing line. Server component only (no client JS). While the city's demo
 * number has not been provisioned yet (`siteConfig.CITY_DEMO_LINES`), the page
 * says so and points at the support address instead of showing a dead number.
 */

const PRICING_LINE =
  "$0 today. 3-day free trial, then $49/month. Cancel anytime.";

export default function CityLanding({ slug }: { slug: keyof typeof CITY_DEMO_LINES }) {
  const line = CITY_DEMO_LINES[slug];
  const hasPhone = Boolean(line.phoneDisplay && line.phoneTel);

  return (
    <main>
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-14 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold">
          {line.city}, {line.state}
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Never miss another {line.city} customer
        </h1>
        <p className="mt-4 text-base leading-relaxed text-white/75">
          When you are under a sink or up a ladder, calls go to voicemail and the
          job goes to the next name on Google. CallFlow answers those missed
          calls in your business name, takes the details, and books the
          appointment, 24 hours a day.
        </p>

        <div className="ios-card mt-8 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            Hear it in 30 seconds
          </h2>
          {hasPhone ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-white/70">
                Call the {line.city} demo line and talk to the CallFlow
                receptionist exactly like a customer would.
              </p>
              <a
                href={`tel:${line.phoneTel}`}
                className="ios-pill-primary mt-5 px-6 py-3 text-[15px]"
              >
                Call the demo: {line.phoneDisplay}
                <Phone className="h-4 w-4" />
              </a>
            </>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              The {line.city} demo line is being set up. Email{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-semibold text-gold underline-offset-2 hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>{" "}
              and we will call you back so you can hear it live.
            </p>
          )}
        </div>

        <div className="mt-8">
          <Link href="/onboarding" className="ios-pill-primary px-6 py-3 text-[15px]">
            Start my free trial
            <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-3 text-sm font-medium text-white/75">{PRICING_LINE}</p>
          <p className="mt-2 text-xs text-white/55">
            Keep your current number: you forward its missed calls to the
            CallFlow number we give you. No new phone, no app to install.
          </p>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
