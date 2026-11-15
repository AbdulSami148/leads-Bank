import type { Metadata } from "next";
import { AccountFrame } from "@/components/account-frame";

export const metadata: Metadata = {
  title: "Users",
  description: "Approve accounts, set quotas and monitor activity.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AccountFrame area="admin" active="users">
      {children}
    </AccountFrame>
  );
}
