import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui";
import { WORKFLOW_STEPS } from "./config/content";

const primaryLinkStyles =
  "landing-button inline-flex items-center justify-center gap-2 rounded-md bg-accent-primary px-5 py-3 text-body font-medium text-white shadow-subtle transition-all duration-150 hover:bg-accent-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function MidPageCTA() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card variant="elevated" className="landing-panel h-full">
          <p className="text-caption uppercase tracking-[0.16em] text-text-tertiary">
            How the workflow stays compact
          </p>
          <h2 className="mt-3 text-display-sm text-text-primary">
            A large dataset should still feel easy to work through.
          </h2>
          <p className="mt-4 text-body-lg text-text-secondary">
            The goal is not more dashboard chrome. It is faster movement from
            incoming signal to decision-ready context, with less tool-switching
            and less noise.
          </p>
          <div className="mt-8">
            <Link href="/waitlist" className={`${primaryLinkStyles} group`}>
              <span>Request access</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          </div>
        </Card>

        <div className="grid gap-3">
          {WORKFLOW_STEPS.map((step) => (
            <div
              key={step.step}
              className="landing-panel rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-xs"
            >
              <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                <span className="font-data text-caption text-accent-primary">
                  {step.step}
                </span>
                <div>
                  <p className="text-body font-medium text-text-primary">
                    {step.title}
                  </p>
                  <p className="mt-2 text-body-sm text-text-secondary">
                    {step.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
