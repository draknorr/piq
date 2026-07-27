import type { Metadata } from "next";

import { OpportunityGameRecordClient } from "./OpportunityGameRecordClient";

export const metadata: Metadata = {
  title: "Opportunity Record | PublisherIQ",
  description: "A canonical, replayable Steam opportunity research record.",
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
