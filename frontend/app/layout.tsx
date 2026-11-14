import type { Metadata } from "next";
import { ToastProvider } from "@/components/toast";
import { ServerStatusBanner } from "@/components/server-status-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leads",
  description: "Instagram lead delivery",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <ToastProvider>{children}</ToastProvider>
        {/* Friendly banner when the backend is waking up or unreachable. */}
        <ServerStatusBanner />
      </body>
    </html>
  );
}
