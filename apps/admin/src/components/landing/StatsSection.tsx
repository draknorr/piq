import { COVERAGE_STATS } from "./config/content";

export function StatsSection() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="text-caption uppercase tracking-[0.16em] text-text-tertiary">
            Coverage
          </p>
          <h2 className="mt-3 text-display-sm text-text-primary">
            Coverage that stays usable.
          </h2>
          <p className="mt-4 text-body-lg text-text-secondary">
            Breadth matters, but the real value is breadth organized into
            surfaces that remain quick to scan, query, and compare.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COVERAGE_STATS.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-xs"
            >
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
