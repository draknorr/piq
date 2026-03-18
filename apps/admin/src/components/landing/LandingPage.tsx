import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/ui";
import { BrandLockup } from "./BrandLockup";
import {
  QUERIES_ID,
  LANDING_CONTENT,
} from "./config/content";

/* ──────────────────────────────────────────────
   Style tokens — sharp edges, editorial precision
   ────────────────────────────────────────────── */

const primaryLinkStyles =
  "landing-button inline-flex items-center justify-center gap-2 rounded-sm bg-accent-primary px-6 py-3 text-body font-medium text-white transition-all duration-150 hover:bg-accent-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const secondaryLinkStyles =
  "landing-button inline-flex items-center justify-center gap-2 rounded-sm border border-border-prominent bg-transparent px-6 py-3 text-body text-text-primary transition-colors duration-150 hover:border-accent-primary hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const invertPrimaryLinkStyles =
  "landing-button inline-flex items-center justify-center gap-2 rounded-sm bg-accent-primary px-6 py-3 text-body font-medium text-white transition-all duration-150 hover:bg-accent-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-invert)]";

const invertSecondaryLinkStyles =
  "landing-button inline-flex items-center justify-center gap-2 rounded-sm border px-6 py-3 text-body transition-colors duration-150 hover:border-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-invert)]";

/* ──────────────────────────────────────────────
   Section label — monospaced, brief-style
   ────────────────────────────────────────────── */

function SectionLabel({
  children,
  invert,
}: {
  children: string;
  invert?: boolean;
}) {
  return (
    <p
      className={`font-data text-[0.68rem] uppercase tracking-[0.28em] ${
        invert ? "opacity-40" : "text-text-tertiary"
      }`}
    >
      {children}
    </p>
  );
}

/* ──────────────────────────────────────────────
   Nav — solid bg, sharp buttons, thin rule
   ────────────────────────────────────────────── */

function LandingNav() {
  return (
    <nav
      className="sticky top-0 z-50 border-b border-border-subtle bg-surface"
      aria-label="Main navigation"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-text-primary"
      >
        Skip to main content
      </a>

      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <BrandLockup />

        <div className="flex items-center gap-2">
          <ThemeToggle className="inline-flex" />
          <Link
            href="/login"
            className={`hidden sm:inline-flex ${secondaryLinkStyles}`}
          >
            <span>Sign in</span>
          </Link>
          <Link href="/waitlist" className={primaryLinkStyles}>
            <span>{LANDING_CONTENT.hero.primaryCta}</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ──────────────────────────────────────────────
   Footer — solid bg, sharp buttons
   ────────────────────────────────────────────── */

function LandingFooter() {
  return (
    <footer className="border-t border-border-subtle bg-surface px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <BrandLockup compact />

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Link
            href="/login"
            className="rounded-sm px-3 py-2 text-body-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            {LANDING_CONTENT.finalCta.secondaryCta}
          </Link>
          <Link href="/waitlist" className={primaryLinkStyles}>
            {LANDING_CONTENT.finalCta.primaryCta}
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* ──────────────────────────────────────────────
   Hero — full-width centered, dramatic tracking
   ────────────────────────────────────────────── */

function HeroSection() {
  return (
    <section className="px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:px-8 lg:pt-24">
      <div className="mx-auto max-w-7xl">
        <div className="landing-reveal mx-auto max-w-4xl text-center">
          <h1 className="text-[clamp(2.6rem,6.5vw,5.2rem)] font-semibold leading-[0.92] tracking-[0.02em] text-text-primary">
            {LANDING_CONTENT.hero.headline}
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-[1.05rem] leading-[1.85] text-text-secondary sm:text-[1.12rem]">
            {LANDING_CONTENT.hero.body}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/waitlist" className={primaryLinkStyles}>
              <span>{LANDING_CONTENT.hero.primaryCta}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a href={`#${QUERIES_ID}`} className={secondaryLinkStyles}>
              <span>{LANDING_CONTENT.hero.secondaryCta}</span>
            </a>
          </div>
        </div>

        {/* Proof strip — data-terminal readout */}
        <div className="landing-reveal landing-reveal-delay-2 mx-auto mt-12 grid max-w-4xl grid-cols-2 border-t border-border-prominent pt-8 sm:grid-cols-4">
          {LANDING_CONTENT.hero.proofPoints.map((point, index) => (
            <div
              key={point.label}
              className={`flex flex-col gap-1.5 px-5 py-2 ${
                index % 2 !== 0
                  ? "border-l border-border-prominent"
                  : ""
              } ${
                index >= 2
                  ? "border-t border-border-prominent sm:border-t-0"
                  : ""
              } ${
                index > 0 && index % 2 === 0
                  ? "sm:border-l sm:border-border-prominent"
                  : ""
              }`}
            >
              <span className="font-data text-[1.5rem] tabular-nums tracking-[0.02em] text-accent-primary sm:text-[1.7rem]">
                {point.value}
              </span>
              <span className="font-data text-[0.62rem] uppercase tracking-[0.24em] text-text-tertiary">
                {point.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────
   Core Argument — pull-quote with coral accent
   ────────────────────────────────────────────── */

function CoreArgumentSection() {
  return (
    <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <div className="mx-auto max-w-7xl border-y border-border-prominent py-12 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:py-16">
        <div className="landing-reveal">
          <div
            className="border-l-2 pl-6 lg:pl-8"
            style={{ borderColor: "var(--accent-primary)" }}
          >
            <h2 className="max-w-2xl text-[clamp(2rem,4.2vw,3.4rem)] font-semibold leading-[1] tracking-[-0.01em] text-text-primary">
              {LANDING_CONTENT.coreArgument.headline}
            </h2>
          </div>
        </div>

        <div className="landing-reveal landing-reveal-delay-1 mt-8 lg:mt-0 lg:flex lg:items-center">
          <p className="max-w-3xl text-[1.04rem] leading-[1.85] text-text-secondary sm:text-[1.12rem]">
            {LANDING_CONTENT.coreArgument.body}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────
   Capabilities — 2×2 numbered grid
   ────────────────────────────────────────────── */

function CapabilitiesSection() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="landing-reveal grid gap-px border border-border-prominent bg-border-prominent sm:grid-cols-2">
          {LANDING_CONTENT.capabilities.map((capability, index) => (
            <article
              key={capability.title}
              className="flex flex-col gap-4 bg-surface p-8 sm:p-10"
            >
              <p className="font-data text-[0.78rem] tabular-nums uppercase tracking-[0.24em] text-text-muted">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="text-[1.25rem] font-semibold leading-tight tracking-[-0.02em] text-text-primary sm:text-[1.35rem]">
                {capability.title}
              </h3>
              <p className="text-body leading-[1.85] text-text-secondary">
                {capability.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────
   Sample Queries — inverted section with accent
   ────────────────────────────────────────────── */

function QueriesSection() {
  return (
    <section
      id={QUERIES_ID}
      className="scroll-mt-28"
      style={{
        backgroundColor: "var(--surface-invert)",
        color: "var(--text-invert)",
      }}
    >
      {/* Thin coral accent line at boundary */}
      <div
        className="h-px"
        style={{ backgroundColor: "var(--accent-primary)" }}
      />

      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="landing-reveal">
          <h2 className="max-w-3xl text-[clamp(2.2rem,4.6vw,3.6rem)] font-semibold leading-[0.96] tracking-[-0.01em]">
            {LANDING_CONTENT.queries.headline}
          </h2>
        </div>

        <div className="mt-14">
          {LANDING_CONTENT.queries.items.map((query, index) => (
            <article
              key={query.question}
              className="landing-reveal grid gap-6 border-t py-10 first:border-t-0 first:pt-0 lg:grid-cols-[5rem_1fr_14rem] lg:gap-8"
              style={{
                borderColor:
                  "color-mix(in srgb, currentColor 12%, transparent)",
              }}
            >
              <p className="font-data text-[1.5rem] tabular-nums tracking-[0.06em] text-accent-primary">
                {String(index + 1).padStart(2, "0")}
              </p>

              <div>
                <h3 className="max-w-4xl text-[1.3rem] font-semibold italic leading-snug tracking-[-0.01em] sm:text-[1.65rem]">
                  {query.question}
                </h3>
                <p className="mt-4 max-w-3xl text-body leading-[1.85] opacity-60">
                  {query.description}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 lg:justify-end lg:pt-1">
                {query.signals.map((signal) => (
                  <span
                    key={signal}
                    className="inline-flex items-center rounded border px-2 py-0.5 font-medium text-caption text-accent-primary"
                    style={{
                      borderColor:
                        "color-mix(in srgb, var(--accent-primary) 30%, transparent)",
                    }}
                  >
                    {signal}
                  </span>
                ))}
              </div>
            </article>
          ))}

          {/* Trailing prompt */}
          <p
            className="landing-reveal border-t pt-10 text-[1.3rem] italic opacity-40 sm:text-[1.65rem]"
            style={{
              borderColor:
                "color-mix(in srgb, currentColor 12%, transparent)",
            }}
          >
            These are examples. Ask anything.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────
   Why It Matters + Leadership — two-column
   ────────────────────────────────────────────── */

function WhyAndLeadershipSection() {
  return (
    <section className="px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-20 lg:px-8">
      <div className="mx-auto max-w-7xl border-t border-border-prominent pt-16 sm:pt-20 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
        {/* Left — statement */}
        <div className="landing-reveal">
          <SectionLabel>Why It Matters</SectionLabel>
          <h2 className="mt-5 max-w-xl text-[clamp(2rem,4vw,3.2rem)] font-semibold leading-[0.97] tracking-[-0.01em] text-text-primary">
            {LANDING_CONTENT.whyItMatters.headline}
          </h2>
          <p className="mt-6 max-w-xl text-[1.04rem] leading-[1.85] text-text-secondary">
            {LANDING_CONTENT.whyItMatters.body}
          </p>
        </div>

        {/* Right — leadership items */}
        <div className="landing-reveal landing-reveal-delay-1 mt-12 lg:mt-0">
          <SectionLabel>What Sets Us Apart</SectionLabel>
          <div className="mt-5 border-t border-border-prominent">
            {LANDING_CONTENT.leadership.map((item, index) => (
              <article
                key={item.title}
                className="group grid grid-cols-[2.5rem_1fr] gap-3 border-b border-border-subtle py-5"
              >
                <p className="font-data text-[0.72rem] tabular-nums uppercase tracking-[0.24em] text-text-muted transition-colors duration-200 group-hover:text-accent-primary">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <div>
                  <h3 className="text-[1.05rem] font-semibold leading-tight tracking-[-0.02em] text-text-primary">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-body-sm leading-[1.8] text-text-secondary">
                    {item.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────
   Final CTA — inverted section with accent
   ────────────────────────────────────────────── */

function FinalCtaSection() {
  return (
    <section
      style={{
        backgroundColor: "var(--surface-invert)",
        color: "var(--text-invert)",
      }}
    >
      {/* Thin coral accent line at boundary */}
      <div
        className="h-px"
        style={{ backgroundColor: "var(--accent-primary)" }}
      />

      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        <div className="landing-reveal mx-auto max-w-3xl text-center">
          <h2 className="text-[clamp(2.2rem,4.6vw,3.6rem)] font-semibold leading-[0.96] tracking-[-0.01em]">
            {LANDING_CONTENT.finalCta.headline}
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-[1.04rem] leading-[1.85] opacity-60">
            {LANDING_CONTENT.finalCta.body}
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/waitlist" className={invertPrimaryLinkStyles}>
              <span>{LANDING_CONTENT.finalCta.primaryCta}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className={invertSecondaryLinkStyles}
              style={{
                borderColor:
                  "color-mix(in srgb, currentColor 20%, transparent)",
              }}
            >
              <span>{LANDING_CONTENT.finalCta.secondaryCta}</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────
   Page shell — clean surface, no orbs, no blur
   ────────────────────────────────────────────── */

export function LandingPage() {
  return (
    <div className="relative min-h-screen bg-surface text-text-primary">
      <LandingNav />

      <main id="main-content" className="relative scroll-mt-14">
        <HeroSection />
        <CoreArgumentSection />
        <QueriesSection />
        <CapabilitiesSection />
        <WhyAndLeadershipSection />
        <FinalCtaSection />
      </main>

      <LandingFooter />
    </div>
  );
}
