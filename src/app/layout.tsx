import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Navigation from "@/components/Navigation";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CallFlow — Never miss another lead",
  description: "Missed calls, caught. Voicemails, logged. CallFlow keeps local businesses from losing customers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#0f1117] text-slate-200">
        <Navigation />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
