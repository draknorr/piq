import type { Metadata } from "next";
import { UsersRound } from "lucide-react";

import { requireAdmin } from "@/lib/auth-utils";

import { OpportunityTeamsManager } from "./OpportunityTeamsManager";

export const metadata: Metadata = {
  title: "Opportunity Teams | Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminOpportunityTeamsPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <header className="border-l-2 border-accent-primary pl-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
          <UsersRound className="h-4 w-4" />
          Opportunity access
        </div>
        <h1 className="mt-2 text-display-sm text-text-primary">Teams</h1>
        <p className="mt-2 max-w-3xl text-body-sm leading-6 text-text-secondary">
          Create teams that can open one another’s exact Opportunity Brief links
          and collaborate through Team Activity. Profiles, deliveries, and
          personal tracker state stay private.
        </p>
      </header>

      <OpportunityTeamsManager />
    </div>
  );
}
