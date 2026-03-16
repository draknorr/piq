import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "PublisherIQ - The Category Leader in Game Market Intelligence",
  description:
    "Track launch timing, pricing, store changes, company moves, and market signals in one system. Ask questions in plain English, compare the titles and companies behind the move, and open the supporting evidence fast.",
};

export default function Page() {
  return <LandingPage />;
}
