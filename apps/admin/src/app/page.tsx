import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "PublisherIQ - Steam Market Intelligence",
  description:
    "Research Steam games and companies, monitor launch and pricing changes, and compare publishers with supporting evidence in one workspace.",
};

export default function Page() {
  return <LandingPage />;
}
