import Link from "next/link";
import { Badge } from "@/components/ui";
import { CTA_BULLETS } from "./config/content";

const primaryLinkStyles =
  "inline-flex items-center justify-center rounded-md bg-accent-primary px-5 py-3 text-body font-medium text-white shadow-subtle transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const secondaryLinkStyles =
  "inline-flex items-center justify-center rounded-md border border-border-muted bg-surface-raised px-5 py-3 text-body text-text-primary transition-colors duration-150 hover:border-border-prominent hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function WaitlistCTA() {
  return (
    <section className="px-4 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-20">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[28px] border border-border-muted bg-surface-raised p-6 shadow-card sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] lg:items-start">
            <div>
              <Badge variant="primary">Invite-only beta</Badge>
              <h2 className="mt-4 text-display-sm text-text-primary">
                Get access to a calmer research workflow.
              </h2>
              <p className="mt-4 max-w-2xl text-body-lg text-text-secondary">
                Join the waitlist if you want launch watch, catalog research,
                company benchmarking, and change intelligence in one place
                instead of spread across tabs and spreadsheets.
              </p>
            </div>

            <div className="rounded-2xl border border-border-subtle bg-surface p-5">
              <p className="text-body font-medium text-text-primary">
                What to expect
              </p>
              <ul className="mt-4 space-y-3">
                {CTA_BULLETS.map((bullet) => (
                  <li
                    key={bullet}
                    className="flex gap-2 text-body-sm text-text-secondary"
                  >
                    <span className="mt-[0.45rem] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex flex-col gap-3">
                <Link href="/waitlist" className={primaryLinkStyles}>
                  Join waitlist
                </Link>
                <Link href="/login" className={secondaryLinkStyles}>
                  Already have access? Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
