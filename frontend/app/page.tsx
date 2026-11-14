import { redirect } from "next/navigation";

/** The root just forwards to the dashboard (which guards the session). */
export default function Home() {
  redirect("/dashboard");
}
