import type { Metadata } from "next";

import { OpportunityGameRecordClient } from "./OpportunityGameRecordClient";

export const metadata: Metadata = {
  title: "Opportunity Record | PublisherIQ",
  description:
    "A decision-ready Steam sourcing opportunity with change, fit, market, and evidence context.",
};

interface PageProps {
  params: Promise<{ appid: string }>;
  searchParams: Promise<{ result?: string }>;
}

export default async function OpportunityGamePage({
  params,
  searchParams,
}: PageProps) {
  const route = await params;
  const query = await searchParams;
  const appid = Number(route.appid);

  return (
    <OpportunityGameRecordClient
      appid={Number.isInteger(appid) && appid > 0 ? appid : 0}
      resultId={query.result ?? ""}
    />
  );
}
