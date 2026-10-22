"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Phone, PhoneCall, Settings } from "lucide-react";

const navItems = [
  { href: "/app", label: "Dashboard", icon: Phone },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Navigation() {
  const pathname = usePathname();
  // Owner-facing display name from /api/me (businesses.billingName). Rendered
  // only when a session is present; stays empty otherwise.
  const [businessName, setBusinessName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ name?: string | null }>) : null))
      .then((data) => {
        if (!cancelled && data?.name) setBusinessName(data.name);
      })
      .catch(() => {
        // Signed out: no name in the header, nothing else changes.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (pathname === "/") return null;

  return (
    <header className="sticky top-0 z-40 border-b border-separator bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gold text-[#0b1f3a] shadow-[var(--shadow-pill)]">
              <Phone className="h-4.5 w-4.5" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-ink">CallFlow</span>
          </Link>
          {businessName && (
            <span className="hidden min-w-0 max-w-[200px] truncate text-sm font-medium text-ink-2 md:inline">
              {businessName}
            </span>
          )}
        </div>
        <nav className="flex items-center gap-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
                  isActive
                    ? "bg-wire/10 text-wire"
                    : "text-ink-2 hover:bg-black/[0.04] hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
