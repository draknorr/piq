import { Activity, ArrowUpRight, Building2, Search } from "lucide-react";
import { Badge } from "@/components/ui";
import {
  PREVIEW_PANELS,
  WATCHLIST_ITEMS,
  WORKBENCH_METRICS,
} from "./config/content";

export function ChatDemo() {
  return (
    <section className="px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[28px] border border-border-muted bg-surface-raised p-4 shadow-card sm:p-6">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle pb-4">
            <Badge variant="primary">Ask</Badge>
            <Badge variant="default">Change Feed</Badge>
            <Badge variant="default">Companies</Badge>
            <Badge variant="default">Catalog</Badge>
            <span className="text-caption text-text-tertiary sm:ml-auto">
              One workflow from question to evidence
            </span>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_19rem]">
            <div>
              <div className="rounded-2xl border border-border-subtle bg-surface p-4">
                <div className="flex items-center gap-2 text-body-sm text-text-secondary">
                  <Search className="h-4 w-4" />
                  Which publishers tightened release timing this week, and what
                  changed on their store pages?
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {PREVIEW_PANELS.map((panel, index) => (
                  <div
                    key={panel.title}
                    className="rounded-2xl border border-border-subtle bg-surface p-5 animate-fade-in-up"
                    style={{ animationDelay: `${120 + index * 80}ms` }}
                  >
                    <p className="text-caption uppercase tracking-[0.16em] text-text-tertiary">
                      {panel.eyebrow}
                    </p>
                    <h2 className="mt-3 text-heading-sm text-text-primary">
                      {panel.title}
                    </h2>
                    <p className="mt-3 text-body-sm text-text-secondary">
                      {panel.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {panel.tags.map((tag) => (
                        <Badge key={tag} variant="default" size="sm">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border-subtle bg-surface p-5">
                <div className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                  <Activity className="h-4 w-4 text-accent-primary" />
                  Live watchlists
                </div>
                <div className="mt-4 space-y-3">
                  {WATCHLIST_ITEMS.map((item) => (
                    <div
                      key={item.name}
                      className="rounded-xl border border-border-subtle bg-surface-raised p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-body font-medium text-text-primary">
                            {item.name}
                          </p>
                          <p className="mt-1 text-body-sm text-text-secondary">
                            {item.detail}
                          </p>
                        </div>
                        <Badge variant={item.variant} size="sm">
                          Active
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border-subtle bg-surface p-5">
                <div className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                  <Building2 className="h-4 w-4 text-accent-primary" />
                  Workbench summary
                </div>
                <div className="mt-4 space-y-3">
                  {WORKBENCH_METRICS.map((metric) => (
                    <div
                      key={metric.label}
                      className="flex items-start justify-between gap-4 border-b border-border-subtle pb-3 last:border-b-0 last:pb-0"
                    >
                      <p className="text-body-sm text-text-secondary">
                        {metric.label}
                      </p>
                      <p className="text-body-sm font-medium text-text-primary">
                        {metric.value}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 inline-flex items-center gap-1 text-body-sm text-accent-primary">
                  Open the full workflow
                  <ArrowUpRight className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
