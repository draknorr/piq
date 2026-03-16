import { BellRing, GitCompareArrows, MessageSquareText } from "lucide-react";
import { Card } from "@/components/ui";
import { FEATURES } from "./config/content";

const ICON_MAP = {
  Ask: MessageSquareText,
  Monitor: BellRing,
  Compare: GitCompareArrows,
} as const;

export function FeaturesSection() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="text-caption uppercase tracking-[0.16em] text-text-tertiary">
            Why teams switch
          </p>
          <h2 className="mt-3 text-display-sm text-text-primary">
            The tools other platforms still make you piece together.
          </h2>
          <p className="mt-4 text-body-lg text-text-secondary">
            PublisherIQ is built for operators who need to research, monitor,
            and compare without losing the thread. That is why it feels faster
            than a database, more grounded than generic AI, and more useful
            than another dashboard.
          </p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {FEATURES.map((feature, index) => {
            const Icon = ICON_MAP[feature.eyebrow];

            return (
              <Card
                key={feature.title}
                variant="interactive"
                className="landing-panel group h-full animate-fade-in-up"
                style={{ animationDelay: `${120 + index * 80}ms` }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary-muted text-accent-primary transition-transform duration-300 group-hover:rotate-3 group-hover:scale-105">
                  <Icon className="h-4 w-4" />
                </div>
                <p className="mt-4 text-caption uppercase tracking-[0.16em] text-text-tertiary">
                  {feature.eyebrow}
                </p>
                <h3 className="mt-2 text-heading-sm text-text-primary">
                  {feature.title}
                </h3>
                <p className="mt-3 text-body-sm text-text-secondary">
                  {feature.description}
                </p>
                <ul className="mt-5 space-y-2">
                  {feature.points.map((point) => (
                    <li
                      key={point}
                      className="flex gap-2 text-body-sm text-text-secondary"
                    >
                      <span className="mt-[0.45rem] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
