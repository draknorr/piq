"use client";

import Link from "next/link";
import { Gamepad2 } from "lucide-react";
import { ThemeToggle } from "@/components/ui";

const primaryLinkStyles =
  "landing-button inline-flex items-center justify-center rounded-md bg-accent-primary px-4 py-2 text-body font-medium text-white shadow-subtle transition-all duration-150 hover:bg-accent-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const secondaryLinkStyles =
  "landing-button inline-flex items-center justify-center rounded-md border border-border-muted bg-surface-raised px-4 py-2 text-body text-text-primary transition-colors duration-150 hover:border-border-prominent hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function LandingNav() {
  return (
    <nav
      className="sticky top-0 z-50 border-b border-border-subtle backdrop-blur"
      aria-label="Main navigation"
      style={{ backgroundColor: "var(--surface-overlay)" }}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-text-primary"
      >
        Skip to main content
      </a>

      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-2.5 text-text-primary transition-opacity hover:opacity-80"
        >
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-primary text-white shadow-subtle transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-[1.04]">
            <Gamepad2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-subheading tracking-tight">
              PublisherIQ
            </p>
            <p className="hidden items-center gap-2 text-body-sm text-text-secondary sm:inline-flex">
              <span className="text-accent-primary">
                <span className="landing-beacon" />
              </span>
              Steam market intelligence
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link
            href="/login"
            className={`hidden sm:inline-flex ${secondaryLinkStyles}`}
          >
            <span>Sign in</span>
          </Link>
          <Link href="/waitlist" className={primaryLinkStyles}>
            <span>Request access</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
