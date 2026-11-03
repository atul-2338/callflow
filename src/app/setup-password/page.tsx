import type { Metadata } from "next";
import Link from "next/link";

import SetupPasswordForm from "@/components/owner/SetupPasswordForm";
import { inspectSetupToken } from "@/lib/business-password";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CallFlow — Create your password",
  description: "Choose a password for your CallFlow account.",
};

/**
 * Page for the one-time setup link emailed (and copyable) from
 * /admin/customers: callflow.biz/setup-password?token=…
 *
 * The token is validated here only to decide which of two things to render —
 * the form or the "expired" notice. The write itself re-checks the link
 * atomically in POST /api/auth/setup-password, so a page left open across the
 * 48-hour expiry still cannot set a password. The raw token is never echoed
 * into the HTML beyond the hidden value the form needs to post back.
 */
function InvalidLink() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-10 sm:pt-16">
      <Link href="/" className="text-sm font-medium text-ink-2 hover:text-ink">
        CallFlow
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        This link has expired or is invalid
      </h1>
      <p className="mt-3 text-sm leading-6 text-ink-2">
        Please contact support at{" "}
        <a href="mailto:atul@callflow.biz" className="font-medium text-ink underline">
          atul@callflow.biz
        </a>{" "}
        and we will send you a new link.
      </p>
      <p className="mt-6 text-sm text-ink-3">
        Already set a password?{" "}
        <Link href="/login" className="font-medium text-ink-2 underline">
          Log in
        </Link>
        .
      </p>
    </main>
  );
}

export default async function SetupPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawToken = params.token;
  const token = typeof rawToken === "string" ? rawToken : "";
  if (inspectSetupToken(token).state !== "valid") {
    return (
      <div className="min-h-screen bg-[#f2f2f7] text-ink">
        <InvalidLink />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f2f2f7] text-ink">
      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-10 sm:pt-16">
        <Link href="/" className="text-sm font-medium text-ink-2 hover:text-ink">
          CallFlow
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Create your password</h1>
        <p className="mt-1.5 text-sm text-ink-2">
          Choose a password for your CallFlow account. This link works once and expires
          in 48 hours.
        </p>
        <SetupPasswordForm token={token} />
      </main>
    </div>
  );
}
