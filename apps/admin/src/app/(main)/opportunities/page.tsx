import type { Metadata } from "next";

import { ConfigurationRequired } from "@/components/ConfigurationRequired";
import { isSupabaseConfigured } from "@/lib/supabase";

import { OpportunityWorkspace } from "./OpportunityWorkspace";

export const metadata: Metadata = {
  title: "Daily Intelligence Desk | PublisherIQ",
  description:
    "Review Steam games that match your sourcing strategy and the commercial changes that made them relevant.",
};

export const dynamic = "force-dynamic";

export default function OpportunitiesPage() {
  if (!isSupabaseConfigured()) {
    return <ConfigurationRequired />;
  }
  return <OpportunityWorkspace />;
}
