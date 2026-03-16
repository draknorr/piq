import { COVERAGE_STATS } from "./config/content";

export function StatsSection() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="text-caption uppercase tracking-[0.16em] text-text-tertiary">
            Why the coverage matters
          </p>
          <h2 className="mt-3 text-display-sm text-text-primary">
            Coverage built for action, not database tourism.
          </h2>
          <p className="mt-4 text-body-lg text-text-secondary">
            Plenty of products can show you more rows. The hard part is turning
            breadth into something operators can actually monitor, query, and
            compare.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COVERAGE_STATS.map((stat, index) => (
            <div
              key={stat.label}
              className="landing-panel relative rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-xs"
            >
              <span
                className="pointer-events-none absolute right-4 top-3 font-data text-[2.5rem] leading-none"
                style={{ color: "var(--border-muted)" }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="font-data text-display-sm text-text-primary">
                {stat.value}
              </p>
              <p className="mt-3 text-body font-medium text-text-primary">
                {stat.label}
              </p>
              <p className="mt-2 text-body-sm text-text-secondary">
                {stat.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
