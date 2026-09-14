import Link from "next/link";
import { ArrowRight, Phone } from "lucide-react";

/**
 * Shared chrome for the public marketing/legal surface (Phase 1B shell +
 * standalone policy pages). Server components only — no client JS.
 */

/** Visible support/contact email on every public page footer. */
export const SUPPORT_EMAIL = "atul@callflow.biz";

export const policyLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/refund-policy", label: "Refund Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#071a36]/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gold text-[#0b1f3a] shadow-[var(--shadow-pill)]">
            <Phone className="h-4.5 w-4.5" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            CallFlow
          </span>
        </Link>
        <nav className="flex items-center gap-5 text-sm font-medium text-white/70">
          <Link href="/pricing" className="hidden hover:text-white sm:inline">
            Pricing
          </Link>
          <Link href="/onboarding" className="ios-pill-primary px-4 py-2 text-sm">
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-gold" />
            <span className="font-semibold text-foreground">CallFlow</span>
          </div>
          <p className="text-sm text-white/55">
            Missed calls, caught. Leads, booked.
          </p>
          <p className="text-sm text-white/55">© 2026 CallFlow</p>
        </div>

        <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/55 sm:justify-start">
          <Link href="/" className="hover:text-white">
            Home
          </Link>
          {policyLinks.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-white">
              {l.label}
            </Link>
          ))}
        </nav>

        <p className="mt-5 text-center text-sm leading-relaxed text-white/55 sm:text-left">
          Questions about a plan, a charge, or a refund? Email us any time at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-semibold text-gold underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
