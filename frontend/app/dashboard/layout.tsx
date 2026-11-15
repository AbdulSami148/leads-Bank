import type { Metadata } from "next";
import { AccountFrame } from "@/components/account-frame";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your Lead Bank quota, leads and Google Sheet.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AccountFrame area="auto" active="dashboard">
      {children}
    </AccountFrame>
  );
}
