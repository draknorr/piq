import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title:
    "PublisherIQ - The most advanced intelligence system in the gaming industry.",
  description:
    "Intelligence for publishers, studios, investors, and analysts. Track launch timing, pricing, store changes, company moves, and industry signals in one system.",
};

export default function Page() {
  return <LandingPage />;
}
