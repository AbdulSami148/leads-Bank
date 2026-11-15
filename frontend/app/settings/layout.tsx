import type { Metadata } from "next";
import { AccountFrame } from "@/components/account-frame";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your Lead Bank account details and password.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AccountFrame area="auto" active="settings">
      {children}
    </AccountFrame>
  );
}
