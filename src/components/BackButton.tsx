"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="mb-6 inline-flex items-center gap-2 rounded-lg border border-navy-600 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-navy-800 hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </button>
  );
}
