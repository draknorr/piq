import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "PublisherIQ - Game Market Intelligence, Deepest on Steam Today",
  description:
    "Track launch, pricing, store, and company signals. Ask plain-English questions. Open the evidence. PublisherIQ gives game teams the most advanced market-intelligence workflow, starting with Steam.",
};

export default function Page() {
  return <LandingPage />;
}
