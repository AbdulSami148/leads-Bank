import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Lead Bank account — access starts after approval.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
