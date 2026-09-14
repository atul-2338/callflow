import Link from "next/link";
import { SiteFooter } from "@/components/marketing/SiteChrome";
import {
  ArrowRight,
  Bell,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Phone,
  PhoneForwarded,
  Star,
} from "lucide-react";

const steps = [
  {
    icon: PhoneForwarded,
    tint: "bg-wire/10 text-wire",
    title: "Forward your missed calls",
    text: "Pick your number and set call forwarding on your carrier — we generate the exact code for you. About two minutes, no hardware.",
  },
  {
    icon: Bot,
    tint: "bg-callback/10 text-callback",
    title: "Our AI answers instantly",
    text: "When you can't pick up, CallFlow's AI receptionist answers in your business name, takes a full message, and answers FAQs.",
  },
  {
    icon: CalendarCheck,
    tint: "bg-booked/10 text-booked",
    title: "Leads become booked jobs",
    text: "Appointments get booked, every call lands in your log with a transcript, and a push hits your phone the moment the call ends.",
  },
];

const stats = [
  { value: "62%", tone: "text-callback", label: "of local business calls go unanswered" },
  { value: "~40%", tone: "text-danger", label: "of callers never try again after a missed call" },
  { value: "2 min", tone: "text-booked", label: "to set CallFlow up for your business" },
];

const reviews = [
  {
    quote:
      "I was losing customers every time I stepped away from the desk. CallFlow caught a leak job, booked it, and I confirmed in minutes.",
    name: "Marcus Reeves",
    business: "Reeves Plumbing, Austin TX",
    stars: 5,
  },
  {
    quote:
      "My salon is one person. While I'm in a chair with a client, CallFlow answers and books the appointment for me.",
    name: "Dana Whitfield",
    business: "Whitfield Beauty Bar, Denver CO",
    stars: 5,
  },
  {
    quote:
      "The transcripts are spot-on. I read them on my phone between calls and decide who to call back first.",
    name: "Priya Sharma",
    business: "Sharma Dental, Seattle WA",
    stars: 5,
  },
  {
    quote:
      "We got a call-back rate of almost 100% since switching. It honestly pays for itself after one saved job.",
    name: "Tom Okafor",
    business: "OK Home Services, Phoenix AZ",
    stars: 4,
  },
  {
    quote:
      "Setup took one coffee break. Forwarding, done. Missed calls stopped slipping through the same week.",
    name: "Luis Herrera",
    business: "Herrera HVAC, Miami FL",
    stars: 5,
  },
];

const trustBadges = [
  "US phone numbers",
  "No apps for your customers",
  "Transcripts saved to your account",
  "Cancel anytime",
];

const planFeatures = [
  "24/7 AI answering & message taking",
  "Appointment booking for your business",
  "Call log with full transcripts",
  "Instant push notification per call",
  "Your own dedicated number",
  "Setup in about 2 minutes",
];

export default function Landing() {
  return (
    <main>
      <Header />
      <Hero />
      <Stats />
      <HowItWorks />
      <Pricing />
      <Reviews />
      <TrustStrip />
      <FinalCta />
      <SiteFooter />
    </main>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#071a36]/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gold text-[#0b1f3a] shadow-[var(--shadow-pill)]">
            <Phone className="h-4.5 w-4.5" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            CallFlow
          </span>
        </div>
        <nav className="flex items-center gap-5 text-sm font-medium text-white/70">
          <a href="#how" className="hidden hover:text-white sm:inline">
            How it works
          </a>
          <a href="#pricing" className="hidden hover:text-white sm:inline">
            Pricing
          </a>
          <Link href="/onboarding" className="ios-pill-primary px-4 py-2 text-sm">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-12 pt-16 text-center sm:pt-24">
      <span className="inline-flex items-center rounded-full bg-gold/15 px-3.5 py-1.5 text-xs font-semibold text-gold">
        AI answering for local businesses
      </span>
      <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-6xl">
        Never miss another call.
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/75">
        CallFlow answers your business&apos;s missed calls with an AI
        receptionist that takes messages, answers FAQs, and books
        appointments — then pings your phone. Set up in two minutes.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/onboarding"
          className="ios-pill-primary px-6 py-3 text-[15px]"
        >
          Start free trial — $0 today
          <ArrowRight className="h-4 w-4" />
        </Link>
        <a href="#how" className="ios-pill-secondary px-6 py-3 text-[15px]">
          See how it works
        </a>
      </div>

      <div className="ios-card mx-auto mt-14 max-w-sm p-5 text-left">
        <div className="flex items-center justify-between border-b border-separator pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wire/10 text-wire">
              <Phone className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">
                Caller (555) 010-2233
              </p>
              <p className="text-xs text-ink-3">Missed your line · just now</p>
            </div>
          </div>
          <span className="rounded-full bg-booked/10 px-2.5 py-1 text-[11px] font-semibold text-booked">
            Answered
          </span>
        </div>
        <ul className="space-y-4 pt-4">
          <li className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-callback/10 text-callback">
              <Bot className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">
                AI receptionist picked up in 2 rings
              </p>
              <p className="text-xs text-ink-3">9:40 AM</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-booked/10 text-booked">
              <CalendarCheck className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">
                Appointment booked — Tue 10:00 AM
              </p>
              <p className="text-xs text-ink-3">Water heater leak · priority</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-wire/10 text-wire">
              <Bell className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">
                Push sent to owner&apos;s iPhone
              </p>
              <p className="text-xs text-ink-3">9:41 AM · transcript attached</p>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-4 sm:px-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.value} className="ios-card p-6 text-center">
            <p className={`text-4xl font-bold tracking-tight ${s.tone}`}>
              {s.value}
            </p>
            <p className="mt-2 text-sm leading-snug text-ink-2">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
      <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        From missed call to booked job
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-base leading-relaxed text-white/70">
        Three steps. No hardware. No apps for your customers.
      </p>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="ios-card p-6">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl ${s.tint}`}
            >
              <s.icon className="h-6 w-6" />
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Step {i + 1}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-ink">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
      <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Simple pricing
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-base text-white/70">
        One plan. Try it free for 3 days — you pay nothing today.
      </p>
      <div className="ios-card mx-auto mt-10 max-w-md p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg font-semibold text-ink">CallFlow Pro</p>
          <span className="rounded-full bg-booked/10 px-3 py-1 text-xs font-semibold text-booked">
            3-day free trial
          </span>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-5xl font-bold tracking-tight text-ink">$0</span>
          <span className="text-sm text-ink-2">due today</span>
        </div>
        <p className="mt-1 text-sm text-ink-2">
          then <b className="text-ink">$49 / month</b> · cancel anytime
        </p>
        <ul className="mt-6 space-y-3">
          {planFeatures.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-ink-2">
              <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-booked" />
              {f}
            </li>
          ))}
        </ul>
        <Link
          href="/onboarding"
          className="ios-pill-primary mt-8 w-full px-4 py-3.5 text-[15px]"
        >
          Start your 3-day free trial
          <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="mt-3 text-center text-xs text-ink-3">
          No charge today. Cancel anytime before day 3. Full details on our{" "}
          <Link
            href="/pricing"
            className="font-semibold text-wire underline underline-offset-2"
          >
            pricing page
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${
            i < count ? "fill-callback text-callback" : "fill-black/10 text-black/10"
          }`}
        />
      ))}
    </div>
  );
}

function Reviews() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
      <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Trusted by local businesses
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-base text-white/70">
        Plumbers, salons, clinics, and contractors across the US never miss a
        lead.
      </p>
      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r) => (
          <figure key={r.name} className="ios-card p-6">
            <Stars count={r.stars} />
            <blockquote className="mt-4 text-sm leading-relaxed text-ink-2">
              “{r.quote}”
            </blockquote>
            <figcaption className="mt-5 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-wire/10 text-sm font-semibold text-wire">
                {r.name.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">{r.name}</p>
                <p className="text-xs text-ink-3">{r.business}</p>
              </div>
            </figcaption>
          </figure>
        ))}
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/25 bg-white/5 p-6 text-center">
          <p className="text-sm font-medium text-white/70">
            Your business could be here
          </p>
          <Link
            href="/onboarding"
            className="ios-pill-primary mt-3 px-4 py-2 text-sm"
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  return (
    <section className="border-y border-white/10 bg-white/[0.04]">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4 py-8 sm:px-6">
        {trustBadges.map((b) => (
          <span
            key={b}
            className="flex items-center gap-2 text-sm font-medium text-white/75"
          >
            <CheckCircle2 className="h-4 w-4 text-booked" />
            {b}
          </span>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
      <div className="rounded-3xl bg-gradient-to-br from-[#0A84FF] to-[#00378F] p-10 text-center text-white shadow-[0_20px_60px_rgba(0,80,200,0.45)] ring-1 ring-gold/50 sm:p-16">
        <Bot className="mx-auto h-10 w-10" />
        <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
          Your next customer is calling right now. Make sure they hear a human
          — even when you can&apos;t.
        </h2>
        <Link
          href="/onboarding"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-semibold text-[#0b1f3a] shadow-[var(--shadow-pill)] transition hover:bg-gold-strong active:scale-[0.98]"
        >
          Get started in 2 minutes
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
