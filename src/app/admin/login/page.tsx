import { permanentRedirect } from "next/navigation";

// /admin is the single admin entry point — it shows the sign-in form when
// signed out and the overview when signed in. This route exists only so old
// bookmarks and links pointing at /admin/login keep working: they are sent
// permanently (308) to /admin. No env reads here on purpose: the redirect is
// unconditional (old URLs never had a reason to exist again).
export const dynamic = "force-dynamic";

export default function AdminLoginRedirectPage(): never {
  permanentRedirect("/admin");
}