import Link from "next/link";
import { SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * Static shell for the standalone policy/pricing pages. Reuses the iOS design
 * tokens from globals.css (navy `--background`, gold `--gold`, white
 * `.ios-card` surfaces with `--ink` text).
 */
export default function PolicyPage({
  eyebrow,
  title,
  intro,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <main>
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-4 pb-20 pt-14 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-white/75">{intro}</p>
        {updated ? (
          <p className="mt-3 text-xs text-white/45">Last updated: {updated}</p>
        ) : null}

        <article className="ios-card mt-8 space-y-8 p-6 sm:p-10">{children}</article>
      </section>

      <SiteFooter />
    </main>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink sm:text-lg">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-2">
        {children}
      </div>
    </section>
  );
}

/** In-card link styling (iOS blue reads better than gold on a white card). */
export function CardLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="font-medium text-wire underline underline-offset-2 hover:text-wire-press"
    >
      {children}
    </Link>
  );
}
