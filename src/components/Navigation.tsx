"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Phone, PhoneCall, Settings } from "lucide-react";

const navItems = [
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Navigation() {
  const pathname = usePathname();

  if (pathname === "/") return null;

  return (
    <header className="sticky top-0 z-40 border-b border-separator bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gold text-[#0b1f3a] shadow-[var(--shadow-pill)]">
            <Phone className="h-4.5 w-4.5" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-ink">CallFlow</span>
        </Link>
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
