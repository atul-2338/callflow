import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CallFlow — Dashboard",
  description: "Every missed call your AI assistant caught, booked, and handled.",
};

/**
 * iOS light-theme shell for the pilot dashboard at /app (build brief Phase 5
 * design language). Deliberately separate from the legacy dark (app) group.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f2f2f7] text-ink">
      <div className="mx-auto w-full max-w-md px-4 pb-16 pt-10 sm:pt-14">
        {children}
      </div>
    </div>
  );
}
