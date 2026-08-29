"use client";

import { useRouter } from "next/navigation";
import OnboardingGate from "@/components/OnboardingGate";
import BackButton from "@/components/BackButton";
import ContactForm from "@/components/ContactForm";
import { apiFetch } from "@/lib/api";
import type { Contact } from "@/lib/types";

export default function NewContactPage() {
  const router = useRouter();

  async function handleSubmit(data: Omit<Contact, "id" | "createdAt" | "updatedAt">) {
    const res = await apiFetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to create contact");
    }
    router.push("/");
  }

  return (
    <OnboardingGate>
      {() => (
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <BackButton />
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white">Add Contact</h1>
            <p className="mt-1 text-sm text-slate-400">Create a new customer record.</p>
          </div>
          <ContactForm onSubmit={handleSubmit} />
        </div>
      )}
    </OnboardingGate>
  );
}
