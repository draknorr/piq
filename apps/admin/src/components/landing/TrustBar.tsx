import { TRUST_ITEMS } from "./config/content";

export function TrustBar() {
  return (
    <section className="px-4 py-4 sm:px-6 sm:py-6">
      <div className="landing-panel mx-auto max-w-6xl rounded-2xl border border-border-subtle bg-surface-raised px-4 py-4 shadow-xs sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_ITEMS.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-xl px-2 py-1 transition-transform duration-200 hover:translate-x-1"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-primary-muted text-accent-primary shadow-xs">
                <span className="landing-beacon" />
              </span>
              <span className="font-data text-heading-sm text-text-primary">
                {item.value}
              </span>
              <span className="text-body-sm text-text-secondary">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
