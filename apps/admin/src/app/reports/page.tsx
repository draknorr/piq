import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accessSmallText } from "@/components/landing/AccessShell";
import {
  areReportsConfigured,
  isReportsAccessTokenValid,
  REPORTS_ACCESS_COOKIE,
} from "@/lib/reports/access";
import { PUBLISHED_REPORTS } from "@/lib/reports/manifest";
import { sanitizeReportsNextPath } from "@/lib/reports/navigation";

export const metadata: Metadata = {
  title: "Reports",
};

const arrow = "\u2192";

interface ReportsPageProps {
  searchParams: Promise<{
    error?: string | string[];
    next?: string | string[];
  }>;
}

function getFirstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getAccessErrorMessage(error: string | undefined): string | null {
  if (error === "invalid") {
    return "That password did not work.";
  }

  if (error === "not-configured") {
    return "Report access is not configured yet.";
  }

  return null;
}

function PublisherIqWordmark() {
  return (
    <h1
      aria-label="PublisherIQ"
      className="font-sans text-[clamp(2.7rem,4.2vw,4.55rem)] font-normal leading-[0.92] tracking-[0.022em] text-[#11130f]"
    >
      <span aria-hidden="true">Publisher</span>
      <span aria-hidden="true" className="text-[#2e7654]">
        IQ
      </span>
    </h1>
  );
}

function ReportsShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="relative min-h-screen-safe overflow-x-hidden bg-[#f7f5ee] text-[#11130f]"
      style={{ colorScheme: "light" }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-8 w-px bg-[#d7d2c9] sm:left-16 lg:left-[4.35rem]"
      />
      <div
        aria-hidden="true"
        className="absolute left-[calc(2rem-4px)] top-[47.8vh] h-2 w-2 bg-[#11130f] sm:left-[calc(4rem-4px)] lg:left-[calc(4.35rem-4px)]"
      />

      <div className="relative z-10 mx-auto flex min-h-screen-safe w-full max-w-[76rem] flex-col px-8 py-12 sm:px-16 lg:px-20 lg:py-16">
        {children}
      </div>
    </main>
  );
}

function ReportsAccessGate({
  errorMessage,
  isConfigured,
  nextPath,
}: {
  errorMessage: string | null;
  isConfigured: boolean;
  nextPath: string;
}) {
  return (
    <ReportsShell>
      <header className="flex items-start justify-between gap-8">
        <PublisherIqWordmark />
        <p className={`${accessSmallText} pt-3 text-right text-[#171814]/45`}>
          Partner reports
        </p>
      </header>

      <section className="flex flex-1 items-center justify-center pb-8 pt-24 sm:pt-32 lg:pt-16">
        <aside className="w-full max-w-[28rem] border-t border-[#d7d2c9] pt-8">
          <p className={`${accessSmallText} mb-8 text-[#171814]/60`}>
            Report access
          </p>

          {isConfigured ? (
            <form action="/reports/access" method="post" className="space-y-8">
              <input type="hidden" name="next" value={nextPath} />
              <div className="space-y-3">
                <label
                  htmlFor="reports-password"
                  className="font-mono text-[0.68rem] leading-none tracking-[0.07em] text-[#171814]/55"
                >
                  Password
                </label>
                <input
                  id="reports-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  className="h-12 w-full border-0 border-b border-[#cfc8bd] bg-transparent px-0 font-sans text-[1rem] leading-none tracking-[-0.01em] text-[#171814] outline-none transition-colors placeholder:text-[#171814]/25 hover:border-[#aaa196] focus:border-[#171814] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                {errorMessage ? (
                  <p className="text-[0.82rem] leading-5 text-[#9a332c]">{errorMessage}</p>
                ) : null}
              </div>

              <button
                type="submit"
                className={`${accessSmallText} group inline-flex h-14 w-full items-center justify-between bg-[#090b09] px-7 text-[#f7f5ee] transition-colors hover:bg-[#171814] focus-visible:bg-[#171814]`}
              >
                <span>Enter</span>
                <span
                  aria-hidden="true"
                  className="text-[1rem] transition-transform group-hover:translate-x-1 group-focus-visible:translate-x-1"
                >
                  {arrow}
                </span>
              </button>
            </form>
          ) : (
            <p className="text-[0.95rem] leading-6 text-[#5f5c54]">
              Set <code className="font-mono text-[#171814]">REPORTS_PASSWORD</code> to enable
              this report library.
            </p>
          )}
        </aside>
      </section>
    </ReportsShell>
  );
}

function ReportsIndex() {
  return (
    <ReportsShell>
      <header className="flex items-start justify-between gap-8">
        <PublisherIqWordmark />
        <p className={`${accessSmallText} pt-3 text-right text-[#171814]/45`}>
          Report library
        </p>
      </header>

      <section className="flex flex-1 items-center justify-center pb-8 pt-24 sm:pt-32 lg:pt-16">
        <div className="w-full max-w-[28rem] border-t border-[#d7d2c9] pt-8">
          <p className={`${accessSmallText} py-8 text-[#171814]/60`}>
            Reports
          </p>
          <div className="divide-y divide-[#d7d2c9] border-y border-[#d7d2c9]">
            {PUBLISHED_REPORTS.map((report) => (
              <Link
                key={report.slug}
                href={`/reports/${report.slug}`}
                className="group block py-7 transition-colors hover:bg-[#fffdf8] focus-visible:bg-[#fffdf8] focus-visible:outline-none"
              >
                <p className={`${accessSmallText} mb-4 text-[#9a332c]`}>
                  {report.date}
                </p>
                <div className="flex items-start justify-between gap-8">
                  <div>
                    <h3 className="text-[1.45rem] font-semibold leading-tight tracking-[-0.02em] text-[#11130f]">
                      {report.title}
                    </h3>
                    <p className="mt-2 text-[0.95rem] leading-6 text-[#5f5c54]">
                      {report.eyebrow}
                    </p>
                    <p className="mt-5 text-[0.96rem] leading-6 text-[#34342e]">
                      {report.description}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="pt-1 text-[1.15rem] text-[#171814]/45 transition-transform group-hover:translate-x-1 group-hover:text-[#171814]"
                  >
                    {arrow}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </ReportsShell>
  );
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeReportsNextPath(getFirstParam(params.next));
  const cookieStore = await cookies();
  const hasAccess = isReportsAccessTokenValid(cookieStore.get(REPORTS_ACCESS_COOKIE)?.value);

  if (hasAccess && nextPath !== "/reports") {
    redirect(nextPath);
  }

  if (!hasAccess) {
    return (
      <ReportsAccessGate
        errorMessage={getAccessErrorMessage(getFirstParam(params.error))}
        isConfigured={areReportsConfigured()}
        nextPath={nextPath}
      />
    );
  }

  return <ReportsIndex />;
}
