import Navigation from "@/components/Navigation";

/**
 * LEGACY dark app shell (calls, settings, contacts, setup).
 * Intentionally kept dark until the Phase 5 iOS rebuild — the design
 * tokens it relies on are preserved in globals.css.
 */
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-200">
      <Navigation />
      <main className="flex-1">{children}</main>
    </div>
  );
}