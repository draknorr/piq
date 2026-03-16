import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import {
  HERO_LOOP,
  HERO_SIGNAL_TILES,
  LANDING_AUDIENCES,
  LANDING_JOBS,
} from "./config/content";

const HERO_NOTES = [
  { label: "Launch watch", value: "14 grouped moves" },
  { label: "Company pattern", value: "3 repeated pricing plays" },
] as const;

const primaryLinkStyles =
  "landing-button inline-flex items-center justify-center gap-2 rounded-md bg-accent-primary px-5 py-3 text-body font-medium text-white shadow-subtle transition-all duration-150 hover:bg-accent-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const secondaryLinkStyles =
  "landing-button inline-flex items-center justify-center rounded-md border border-border-muted bg-surface-raised px-5 py-3 text-body text-text-primary transition-colors duration-150 hover:border-border-prominent hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function HeroSection() {
  return (
    <section className="px-4 pb-10 pt-14 sm:px-6 sm:pb-14 sm:pt-20">
      <div className="mx-auto grid max-w-7xl gap-10 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)] xl:items-end">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 animate-fade-in-up">
            <Badge variant="primary">Invite-only beta</Badge>
            <Badge variant="default">Deepest on Steam today</Badge>
          </div>

          <h1 className="mt-6 max-w-3xl text-display-lg text-text-primary sm:text-[4.25rem]">
            The most advanced market-intelligence workflow in games.
          </h1>

          <p className="mt-5 max-w-2xl text-body-lg text-text-secondary">
            PublisherIQ gives publishers, studios, investors, and analysts
            tools no other platform puts in one system: evidence-linked change
            intelligence, company benchmarking, and plain-English research that
            stays grounded in the data. Start with the deepest Steam workflows
            in the market and carry the same research flow into broader signals
            as the platform expands.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {LANDING_AUDIENCES.map((audience) => (
              <Badge key={audience} variant="default">
                {audience}
              </Badge>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/waitlist" className={`${primaryLinkStyles} group`}>
              <span>Apply for beta access</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
            <Link href="/login" className={secondaryLinkStyles}>
              <span>Sign in</span>
            </Link>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {LANDING_JOBS.map((job, index) => (
              <Card
                key={job.title}
                className="landing-panel h-full animate-fade-in-up"
                style={{ animationDelay: `${120 + index * 60}ms` }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-caption uppercase tracking-[0.16em] text-text-tertiary">
                    {job.title}
                  </p>
                  <span className="text-accent-primary">
                    <span className="landing-beacon" />
                  </span>
                </div>
                <p className="mt-3 text-body text-text-secondary">
                  {job.description}
                </p>
              </Card>
            ))}
          </div>
        </div>

        <Card variant="elevated" className="landing-panel overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle pb-4">
            <div>
              <p className="text-caption uppercase tracking-[0.16em] text-text-tertiary">
                The daily advantage
              </p>
              <p className="mt-3 text-heading-sm text-text-primary">
                Ask once. Follow the thread to proof.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface px-3 py-1 text-caption text-text-secondary shadow-xs">
              <span className="text-accent-primary">
                <span className="landing-beacon" />
              </span>
              Live workflow
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {HERO_LOOP.map((item) => (
              <div
                key={item.step}
                className="grid grid-cols-[auto_1fr] gap-3 rounded-2xl px-2 py-1 transition-colors duration-150 hover:bg-surface"
              >
                <span className="font-data text-caption text-accent-primary">
                  {item.step}
                </span>
                <div>
                  <p className="text-body font-medium text-text-primary">
                    {item.title}
                  </p>
                  <p className="mt-1 text-body-sm text-text-secondary">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {HERO_SIGNAL_TILES.map((tile) => (
              <div
                key={tile.label}
                className="landing-panel rounded-xl border border-border-subtle bg-surface p-3"
              >
                <p className="font-data text-heading-sm text-text-primary">
                  {tile.value}
                </p>
                <p className="mt-1 text-body-sm text-text-secondary">
                  {tile.label}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {HERO_NOTES.map((note, index) => (
              <div
                key={note.label}
                className={`rounded-2xl border border-border-subtle bg-surface px-3 py-2 shadow-xs transition-transform duration-200 ${
                  index % 2 === 0
                    ? "-rotate-[0.5deg] hover:rotate-0"
                    : "rotate-[0.5deg] hover:rotate-0"
                }`}
              >
                <p className="text-caption uppercase tracking-[0.16em] text-text-tertiary">
                  {note.label}
                </p>
                <p className="mt-1 text-body-sm font-medium text-text-primary">
                  {note.value}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
