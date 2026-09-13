/** iOS-style marketing shell: landing + onboarding (Phase 1B). */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F2F2F7] text-[#1C1C1E]">{children}</div>
  );
}