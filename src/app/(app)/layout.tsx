import Navigation from "@/components/Navigation";

/**
 * iOS-light app shell (calls, settings, contacts, setup) — matches the
 * Phase 5 dashboard at /app. Marketing pages keep the dark navy + gold
 * theme via the (marketing) layout.
 */
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f2f2f7] text-ink">
      <Navigation />
      <main className="flex-1">{children}</main>
    </div>
  );
}