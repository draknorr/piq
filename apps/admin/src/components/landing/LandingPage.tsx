import { LandingNav } from "./LandingNav";
import { HeroSection } from "./HeroSection";
import { ChatDemo } from "./ChatDemo";
import { TrustBar } from "./TrustBar";
import { FeaturesSection } from "./FeaturesSection";
import { MidPageCTA } from "./MidPageCTA";
import { StatsSection } from "./StatsSection";
import { WaitlistCTA } from "./WaitlistCTA";
import { LandingFooter } from "./LandingFooter";

export function LandingPage() {
  return (
    <div
      id="main-content"
      className="relative isolate min-h-screen overflow-hidden bg-surface text-text-primary"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="landing-grid-texture absolute inset-0 opacity-60" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top left, var(--accent-primary-muted) 0%, transparent 36%), radial-gradient(circle at top right, var(--semantic-info-muted) 0%, transparent 28%), linear-gradient(180deg, transparent 0%, var(--surface-elevated) 55%, var(--surface) 100%)",
          }}
        />
        <div
          className="landing-float absolute left-[7%] top-24 h-28 w-28 rounded-[2rem] border border-border-subtle shadow-sm"
          style={{
            background:
              "linear-gradient(180deg, var(--surface-overlay) 0%, var(--accent-primary-muted) 100%)",
            opacity: 0.75,
          }}
        />
        <div
          className="absolute left-1/2 top-28 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--accent-primary-muted) 0%, transparent 72%)",
            opacity: 0.75,
          }}
        />
        <div
          className="landing-float landing-float-delay landing-float-slow absolute right-[6%] top-40 h-36 w-36 rounded-full border border-border-subtle blur-sm"
          style={{
            background:
              "radial-gradient(circle, var(--semantic-info-muted) 0%, transparent 72%)",
            opacity: 0.72,
          }}
        />
        <div className="absolute inset-x-8 top-24 h-px bg-gradient-to-r from-transparent via-border-prominent to-transparent opacity-60" />
        <div className="absolute inset-x-12 top-[36rem] h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent opacity-80" />
      </div>

      <LandingNav />

      <main className="relative z-10">
        <HeroSection />
        <ChatDemo />
        <TrustBar />
        <FeaturesSection />
        <MidPageCTA />
        <StatsSection />
        <WaitlistCTA />
      </main>

      <LandingFooter />
    </div>
  );
}
