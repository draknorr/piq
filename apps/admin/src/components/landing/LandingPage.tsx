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
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top left, var(--accent-primary-muted) 0%, transparent 36%), radial-gradient(circle at top right, var(--semantic-info-muted) 0%, transparent 28%), linear-gradient(180deg, transparent 0%, var(--surface-elevated) 55%, var(--surface) 100%)",
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
