import Link from "next/link";

interface BrandLockupProps {
  compact?: boolean;
}

export function BrandLockup({ compact = false }: BrandLockupProps) {
  return (
    <Link
      href="/"
      className="group inline-flex min-w-0 items-center gap-3 text-text-primary transition-opacity hover:opacity-80"
    >
      <span
        className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[1.1rem] border border-border-muted bg-surface-raised"
        style={{ boxShadow: "var(--shadow-sm)" }}
      >
        <span className="font-data text-[0.72rem] tracking-[0.22em] text-text-primary">
          PIQ
        </span>
        <span className="absolute bottom-[0.42rem] right-[0.42rem] h-1.5 w-1.5 rounded-full bg-accent-primary" />
      </span>

      <span className="min-w-0">
        <span className="block truncate text-[1rem] font-semibold tracking-[-0.04em] text-text-primary">
          PublisherIQ
        </span>
        {!compact ? (
          <span className="mt-0.5 block truncate text-[0.68rem] uppercase tracking-[0.22em] text-text-tertiary">
            Game market intelligence
          </span>
        ) : null}
      </span>
    </Link>
  );
}
