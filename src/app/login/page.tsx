import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import LoginForm from "@/components/owner/LoginForm";
import {
  businessSessionCookieName,
  verifyBusinessSessionToken,
} from "@/lib/business-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CallFlow — Log in",
  description: "Sign in to your CallFlow account.",
};

/**
 * Owner sign-in page.
 *
 * An owner who still holds a valid session never sees the form — they are sent
 * straight to the dashboard. `/setup=success` (set by the setup-password form
 * after it consumed the one-time link) renders the confirmation banner.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const cookieStore = await cookies();
  const businessId = verifyBusinessSessionToken(
    cookieStore.get(businessSessionCookieName())?.value
  );
  if (businessId) redirect("/app");

  const params = await searchParams;
  const justSetUp = params.setup === "success";

  return (
    <div className="min-h-screen bg-[#f2f2f7] text-ink">
      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-10 sm:pt-16">
        <Link href="/" className="text-sm font-medium text-ink-2 hover:text-ink">
          CallFlow
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="mt-1.5 text-sm text-ink-2">
          Your missed calls, captured and answered.
        </p>

        {justSetUp && (
          <p
            role="status"
            className="mt-5 rounded-[10px] border border-[#1f8a3b]/30 bg-[#1f8a3b]/10 px-3 py-2.5 text-sm font-medium text-[#1f8a3b]"
          >
            Password created! Log in below.
          </p>
        )}

        <LoginForm />

        <p className="mt-6 text-sm text-ink-3">
          Forgot your password?{" "}
          <a href="mailto:atul@callflow.biz" className="font-medium text-ink-2 underline">
            Email support
          </a>
          .
        </p>
      </main>
    </div>
  );
}
