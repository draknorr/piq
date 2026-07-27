import type { Metadata } from "next";

import { ConfigurationRequired } from "@/components/ConfigurationRequired";
import { isSupabaseConfigured } from "@/lib/supabase";

import { OpportunityWorkspace } from "./OpportunityWorkspace";

export const metadata: Metadata = {
  title: "Opportunity Brief | PublisherIQ",
  description:
    "Build custom Steam sourcing profiles and investigate a daily evidence-backed opportunity brief.",
};

export const dynamic = "force-dynamic";

export default function OpportunitiesPage() {
  if (!isSupabaseConfigured()) {
    return <ConfigurationRequired />;
  }
  return <OpportunityWorkspace />;
}
