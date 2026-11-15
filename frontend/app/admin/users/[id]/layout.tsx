import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "User activity",
  description: "Quota, daily history and lead jobs of a Lead Bank user.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
