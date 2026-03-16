import { Gamepad2 } from "lucide-react";
import { FOOTER_LINKS } from "./config/content";

export function LandingFooter() {
  return (
    <footer className="border-t border-border-subtle px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary text-white shadow-subtle">
            <Gamepad2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-body font-medium text-text-primary">
              PublisherIQ
            </p>
            <p className="text-body-sm text-text-secondary">
              Game market intelligence, deepest on Steam today
            </p>
          </div>
        </div>

        <p className="text-body-sm text-text-secondary">
          Built by{" "}
          <a
            href={FOOTER_LINKS.author.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-text-primary transition-colors hover:text-accent-primary"
          >
            {FOOTER_LINKS.author.name}
          </a>
        </p>
      </div>
    </footer>
  );
}
