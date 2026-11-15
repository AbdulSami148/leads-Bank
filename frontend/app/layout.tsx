import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { ServerStatusBanner } from "@/components/server-status-banner";
import "./globals.css";

/** Inter, loaded locally by next/font (no external request at runtime). */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Lead Bank",
    template: "%s · Lead Bank",
  },
  description: "Lead Bank — fresh Instagram leads delivered to your Google Sheet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <ToastProvider>{children}</ToastProvider>
        {/* Friendly banner when the backend is waking up or unreachable. */}
        <ServerStatusBanner />
      </body>
    </html>
  );
}
