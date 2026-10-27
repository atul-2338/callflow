import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Temporary safety net: the /setup wizard was replaced by the ONE linear
// flow at /onboarding. Bookmarks and old emails land here and are sent
// straight there (this redirect can be removed in a follow-up).
export default function SetupPage() {
  redirect("/onboarding");
}
