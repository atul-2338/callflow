"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="mb-6 inline-flex items-center gap-2 rounded-full border border-separator bg-white px-4 py-2 text-sm font-medium text-ink-2 shadow-sm transition hover:bg-black/[0.03]"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </button>
  );
}
