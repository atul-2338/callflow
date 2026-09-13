"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Mic,
  Phone,
  PhoneCall,
  PhoneForwarded,
  Star,
  Voicemail,
} from "lucide-react";

const steps = [
  {
    icon: PhoneForwarded,
    title: "Connect your number",
    text: "Enter your business phone and forward missed calls to CallFlow in under two minutes.",
  },
  {
    icon: Voicemail,
    title: "We catch every missed call",
    text: "If you don't answer within 20 seconds, we pick up, take a message, and save it automatically.",
  },
  {
    icon: BarChart3,
    title: "Turn leads into callbacks",
    text: "Every voicemail lands in your dashboard with the transcript and a one-tap call-back button.",
  },
];

const stats = [
  { value: "62%", label: "of local business calls go unanswered" },
  { value: "~40%", label: "of callers never try again after voicemail" },
  { value: "1 min", label: "to set up CallFlow for your business" },
];

const reviews = [
  {
    quote:
      "I was losing customers every time I stepped away from the desk. CallFlow caught a leak job and I called back in minutes.",
    name: "Marcus Reeves",
    business: "Reeves Plumbing, Austin TX",
    stars: 5,
  },
  {
    quote:
      "My salon is one person. While I'm in a chair with a client, CallFlow answers, takes the message, and books get saved.",
    name: "Dana Whitfield",
    business: "Whitfield Beauty Bar, Denver CO",
    stars: 5,
  },
  {
    quote:
      "The voicemail transcripts are spot-on. I read them on my phone between calls and decide who to call back first.",
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

const trustBadges = ["Verified US businesses", "PCI-free, no setup fees", "GDPR-ready transcripts", "2-minute setup"];

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i < count ? "fill-amber-400 text-amber-400" : "fill-white/10 text-white/10"}`}
        />
      ))}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0f1117]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-500/20">
            <Phone className="h-4.5 w-4.5" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">CallFlow</span>
        </div>
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-400">
          <a href="#how-it-works" className="hidden hover:text-white sm:inline">
            How it works
          </a>
          <Link href="/dashboard" className="hidden hover:text-white sm:inline">
            Dashboard
          </Link>
          <Link
            href="/setup"
            className="rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-medium text-brand-300">
              <CheckCircle2 className="h-4 w-4" />
              Never lose a lead again
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Every missed call is money on the table.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-slate-400">
              When you&apos;re on another call, in a back room, or closed for lunch,
              CallFlow picks up in 20 seconds, records a voicemail, and puts it in
              your dashboard — so no lead slips through.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/setup"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-colors hover:bg-brand-400"
              >
                Start for free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10"
              >
                View demo dashboard
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-2xl shadow-black/40">
              <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                  <PhoneCall className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white">Missed call caught</p>
                  <p className="text-xs text-slate-500">Just now · 41 sec voicemail</p>
                </div>
                <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-semibold text-brand-300">
                  New lead
                </span>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Voicemail transcript
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    “Hi, my bathroom faucet is leaking and I need someone today — my number
                    is…”
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1 rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-slate-500">Caller</p>
                    <p className="text-sm font-semibold text-slate-100">+1 (555) 123-4567</p>
                  </div>
                  <div className="flex-1 rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-slate-500">Action</p>
                    <p className="text-sm font-semibold text-brand-400">Call back →</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -left-6 -top-6 -z-10 h-40 w-40 rounded-full bg-brand-500/10 blur-2xl" />
            <div className="absolute -bottom-8 -right-6 -z-10 h-48 w-48 rounded-full bg-brand-500/5 blur-3xl" />
          </div>
        </div>
      </section>

      <section className="border-y border-white/5 bg-[#11141c]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-3 sm:px-6 lg:px-8">
          {stats.map((s) => (
            <div key={s.label} className="text-center sm:text-left">
              <p className="text-3xl font-bold tracking-tight text-white">{s.value}</p>
              <p className="mt-1 text-sm text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Set up once. Catch every call.
          </h2>
          <p className="mt-4 text-lg text-slate-400">
            Built for plumbers, salons, clinics, and contractors who can&apos;t always
            answer the phone.
          </p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <div
              key={title}
              className="relative rounded-2xl border border-white/10 bg-[#161a24] p-6 transition-colors hover:border-white/20"
            >
              <span className="absolute right-5 top-5 text-sm font-semibold text-white/10">
                0{i + 1}
              </span>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
                <Icon className="h-5.5 w-5.5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Trusted by local businesses
          </h2>
          <p className="mt-4 text-lg text-slate-400">
            Plumbers, salons, clinics, and contractors across the US never miss a lead.
          </p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((r) => (
            <figure
              key={r.name}
              className="rounded-2xl border border-white/10 bg-[#161a24] p-6 transition-colors hover:border-white/20"
            >
              <Stars count={r.stars} />
              <blockquote className="mt-4 text-sm leading-relaxed text-slate-300">
                “{r.quote}”
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/15 text-sm font-semibold text-brand-300">
                  {r.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{r.name}</p>
                  <p className="text-xs text-slate-500">{r.business}</p>
                </div>
              </figcaption>
            </figure>
          ))}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-6 text-center">
            <p className="text-sm font-medium text-slate-400">Your business could be here</p>
            <Link
              href="/setup"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 hover:bg-brand-400"
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-white/5 bg-[#11141c]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-12 gap-y-4 px-4 py-10 sm:px-6 lg:px-8">
          {trustBadges.map((b) => (
            <span key={b} className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-brand-500/60" />
              {b}
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-brand-500/20 bg-gradient-to-br from-brand-500/10 via-transparent to-transparent p-10 text-center sm:p-16">
          <Mic className="mx-auto h-8 w-8 text-brand-400" />
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Your next customer is calling right now. Make sure you hear them.
          </h2>
          <Link
            href="/setup"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-colors hover:bg-brand-400"
          >
            Get started in 2 minutes
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-white/5 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-brand-400" />
          <span className="font-semibold text-slate-300">CallFlow</span>
        </div>
        <p>Missed calls, caught. Voicemails, logged.</p>
      </footer>
    </div>
  );
}
