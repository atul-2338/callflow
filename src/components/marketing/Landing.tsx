import Link from "next/link";
import { SiteFooter } from "@/components/marketing/SiteChrome";
import WaitlistForm from "@/components/marketing/WaitlistForm";
import {
  DEMO_AUDIO_SRC,
  DEMO_PHONE_DISPLAY,
  DEMO_PHONE_TEL,
} from "@/lib/siteConfig";
import {
  ArrowRight,
  Bell,
  Bot,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  Phone,
  PhoneForwarded,
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
  { value: "24/7", tone: "text-callback", label: "AI answering, nights and weekends" },
  { value: "$49", tone: "text-gold", label: "flat per month, no per-minute fees" },
  { value: "2 min", tone: "text-booked", label: "to set CallFlow up for your business" },
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
      <HearIt />
      <Stats />
      <HowItWorks />
      <Pricing />
      <FoundingCustomer />
      <TrustStrip />
      <Waitlist />
      <Faq />

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
          <a href="#faq" className="hidden hover:text-white sm:inline">
            Questions
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
      <p className="mt-3 text-xs text-white/70">Example</p>
    </section>
  );
}

function HearIt() {
  const hasPhone = DEMO_PHONE_DISPLAY !== "" && DEMO_PHONE_TEL !== "";
  const hasAudio = DEMO_AUDIO_SRC !== "";
  if (!hasPhone && !hasAudio) return null;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-16 text-center sm:px-6">
      <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Hear it for yourself
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-white/70">
        Call our demo line and talk to the CallFlow AI receptionist like a
        customer would.
      </p>
      {hasPhone && (
        <a
          href={`tel:${DEMO_PHONE_TEL}`}
          className="ios-pill-primary mt-8 px-6 py-3 text-[15px]"
        >
          Call the demo: {DEMO_PHONE_DISPLAY}
          <Phone className="h-4 w-4" />
        </a>
      )}
      {hasAudio && (
        <div className="mt-8">
          <audio
            controls
            preload="none"
            src={DEMO_AUDIO_SRC}
            className="mx-auto w-full max-w-md"
          />
          <p className="mt-2 text-xs text-white/70">
            Listen to a sample call (about 30 seconds)
          </p>
        </div>
      )}
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

function FoundingCustomer() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
      <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Be one of our first 10 businesses
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-base text-white/70">
        We&apos;re onboarding our first 10 local businesses. Founding customers
        keep the $49/month price for as long as they stay subscribed, and get
        direct access to the founder for setup and feedback.
      </p>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm text-white/70">
        Built for plumbers, salons, clinics, and contractors.
      </p>
      <div className="mt-8 flex justify-center">
        <Link
          href="/onboarding"
          className="ios-pill-primary px-6 py-3 text-[15px]"
        >
          Claim a founding spot
          <ArrowRight className="h-4 w-4" />
        </Link>
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

function Waitlist() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center sm:p-12">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Tester slots open soon
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/70">
          We&apos;re onboarding a small group of local businesses first. Join the
          waitlist and we&apos;ll email you the moment your slot opens.
        </p>
        <WaitlistForm />
      </div>
    </section>
  );
}

const faqs = [
  {
    q: "Does it work with my carrier?",
    a: "CallFlow works with US carriers that support forwarding unanswered calls, including Verizon, AT&T, and T-Mobile. During setup we generate the exact forwarding code for your carrier.",
  },
  {
    q: "Do I have to change my business number?",
    a: "No. Customers keep calling your existing number. CallFlow only receives the calls you don't answer.",
  },
  {
    q: "What if the AI can't answer a question?",
    a: "It takes a detailed message with the caller's name, number, and reason for calling, then sends a push notification to your phone with the transcript attached.",
  },
  {
    q: "Can I turn it off?",
    a: "Yes. Call forwarding is set on your own carrier, so you can switch it off any time using your carrier's forwarding-cancel code. You can also cancel your CallFlow plan at any time.",
  },
  {
    q: "Are calls recorded?",
    a: "Calls are transcribed and saved to your account so you can review them. Recording and notification rules vary by state, so please review our Terms of Service and Privacy Policy.",
  },
  {
    q: "How does the free trial work?",
    a: "You pay $0 today. Cancel any time before day 3 and you are never charged. After that, $49 per month, cancel any time.",
  },
];

function Faq() {
  return (
    <section id="faq" className="mx-auto w-full max-w-3xl px-4 py-20 sm:px-6">
      <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Common questions
      </h2>
      <div className="ios-card mt-10 divide-y divide-separator overflow-hidden">
        {faqs.map((f) => (
          <details key={f.q} className="group px-6 py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
              {f.q}
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">{f.a}</p>
          </details>
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
