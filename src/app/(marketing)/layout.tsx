/** iOS-style marketing shell: landing + onboarding (Phase 1B). */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="marketing-shell min-h-screen text-foreground">{children}</div>
  );
}