"use client";

import { Suspense, useState, useEffect, FormEvent, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Gamepad2,
  Mail,
  UserPlus,
  ArrowRight,
  Loader2,
  KeyRound,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { waitForAuthenticatedBrowserUser } from "@/lib/auth/browser-session";
import { sanitizeAuthNextPath } from "@/lib/auth/redirects";
import { createBrowserClientNoRefresh } from "@/lib/supabase/client";

const AUTH_DEBUG = process.env.NEXT_PUBLIC_AUTH_DEBUG === "true";
const AUTH_SESSION_READY_TIMEOUT_MS = 5000;
const VERIFY_OTP_TIMEOUT_MS = 15000;
const SESSION_CHECK_TIMEOUT_MS = 3000;
type LoginSupabaseClient = ReturnType<typeof createBrowserClientNoRefresh>;

function mapAuthError(
  error: { status?: number; message?: string } | null,
): string {
  if (!error) return "We could not complete sign-in. Please try again.";
  const msg = error.message?.toLowerCase() ?? "";
  if (error.status === 429 || msg.includes("rate limit")) {
    return "Too many attempts. Please wait a few minutes before trying again.";
  }
  if (msg.includes("expired")) {
    return "Your code has expired. Please request a new one.";
  }
  if (msg.includes("invalid")) {
    return "That code did not work. Check the 8-digit code and try again.";
  }
  return "We could not complete sign-in. Please try again.";
}

function logAuthDebug(
  message: string,
  details: Record<string, unknown> = {},
): void {
  if (!AUTH_DEBUG || typeof window === "undefined") {
    return;
  }

  console.info("[auth][login]", {
    message,
    hostname: window.location.hostname,
    ...details,
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeoutPromise]);
}

function getOrCreateLoginSupabaseClient(ref: {
  current: Promise<LoginSupabaseClient> | null;
}): Promise<LoginSupabaseClient> {
  if (!ref.current) {
    const client = createBrowserClientNoRefresh();
    ref.current = client.auth
      .stopAutoRefresh()
      .catch((err) => {
        logAuthDebug("stop-auto-refresh-failed", { error: String(err) });
      })
      .then(() => client);
  }

  return ref.current;
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeAuthNextPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showWaitlistPrompt, setShowWaitlistPrompt] = useState(false);

  // OTP flow state
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const otpInputRef = useRef<HTMLInputElement>(null);

  // Resend cooldown
  const [resendCooldown, setResendCooldown] = useState(0);
  const loginSupabasePromiseRef = useRef<Promise<LoginSupabaseClient> | null>(
    null,
  );

  // Redirect authenticated users to their intended destination
  // The login flow uses an isolated browser client, so we can passively
  // observe any existing session without touching shared auth state.
  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      if (searchParams.get("error") === "profile_recovery_failed") {
        return;
      }

      try {
        const supabase = await getOrCreateLoginSupabaseClient(
          loginSupabasePromiseRef,
        );
        const {
          data: { session },
        } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_CHECK_TIMEOUT_MS,
          "existing-session-check",
        );

        logAuthDebug("existing-session-check", { hasSession: !!session });
        if (!session) {
          return;
        }

        const authReadyResult = await waitForAuthenticatedBrowserUser({
          client: supabase,
          timeoutMs: AUTH_SESSION_READY_TIMEOUT_MS,
        });

        logAuthDebug("existing-session-authoritative-check", {
          ok: authReadyResult.ok,
          sourceOrReason: authReadyResult.ok
            ? authReadyResult.source
            : authReadyResult.reason,
        });

        if (!cancelled && authReadyResult.ok) {
          router.replace(nextPath);
        }
      } catch (err) {
        logAuthDebug("existing-session-check-failed", { error: String(err) });
      }
    };

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [nextPath, router, searchParams]);

  // Handle error from failed auth callback
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError === "auth_failed" || urlError === "invalid_token") {
      setError("Sign-in code expired or invalid. Please request a new one.");
    } else if (urlError === "missing_token") {
      setError("Invalid sign-in link. Please request a new one.");
    } else if (urlError === "profile_recovery_failed") {
      setError(
        "Your sign-in succeeded, but we could not restore your account profile. Please try again.",
      );
    }
  }, [searchParams]);

  // Focus OTP input when shown
  useEffect(() => {
    if (otpSent && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [otpSent]);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [resendCooldown > 0]); // only re-run when transitioning between active/inactive

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setShowWaitlistPrompt(false);
    setIsLoading(true);

    try {
      // Step 1: Validate email is approved
      const validateResponse = await fetch("/api/auth/validate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      // SECURITY FIX (AUTH-11): Check response status before parsing JSON
      if (!validateResponse.ok) {
        setError(
          "We could not check whether this email has access. Please try again.",
        );
        setIsLoading(false);
        return;
      }

      const validation = await validateResponse.json();

      if (!validation.valid) {
        if (validation.reason === "not_approved") {
          // Show friendly waitlist prompt instead of error
          setShowWaitlistPrompt(true);
        } else {
          setError(
            validation.message ||
              "This email is not approved for PublisherIQ yet.",
          );
        }
        setIsLoading(false);
        return;
      }

      // Step 2: Send OTP code (only for approved emails)
      const supabase = await getOrCreateLoginSupabaseClient(
        loginSupabasePromiseRef,
      );

      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      });

      if (authError) {
        console.error("Auth error:", authError);
        setError(mapAuthError(authError));
        setIsLoading(false);
        return;
      }

      // Show OTP entry form
      setOtpSent(true);
      setOtp("");
      setResendCooldown(60);
    } catch {
      setError("We could not send a sign-in code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsVerifying(true);

    try {
      const supabase = await getOrCreateLoginSupabaseClient(
        loginSupabasePromiseRef,
      );

      const { data, error: verifyError } = await withTimeout(
        supabase.auth.verifyOtp({
          email,
          token: otp,
          type: "email",
        }),
        VERIFY_OTP_TIMEOUT_MS,
        "verify-otp",
      );

      if (verifyError) {
        console.error("OTP verification error:", verifyError);
        setError(mapAuthError(verifyError));
        setIsVerifying(false);
        return;
      }

      logAuthDebug("verify-otp-success", { hasDataSession: !!data.session });

      // Confirm we actually have a session before redirecting
      let hasSession = !!data.session;
      if (!hasSession) {
        const {
          data: { session },
        } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_CHECK_TIMEOUT_MS,
          "session-check-after-verify",
        );
        hasSession = !!session;
      }

      if (!hasSession) {
        setError(
          "The code worked, but we could not finish signing you in. Please try again.",
        );
        setIsVerifying(false);
        return;
      }

      const authReadyResult = await waitForAuthenticatedBrowserUser({
        client: supabase,
        timeoutMs: AUTH_SESSION_READY_TIMEOUT_MS,
      });

      logAuthDebug("post-verify-authoritative-check", {
        ok: authReadyResult.ok,
        sourceOrReason: authReadyResult.ok
          ? authReadyResult.source
          : authReadyResult.reason,
        error: authReadyResult.ok ? null : (authReadyResult.error ?? null),
      });

      if (!authReadyResult.ok) {
        try {
          const { error: signOutError } = await supabase.auth.signOut({
            scope: "local",
          });
          if (signOutError) {
            logAuthDebug("post-verify-session-cleanup-failed", {
              error: signOutError.message,
            });
          }
        } catch (cleanupError) {
          logAuthDebug("post-verify-session-cleanup-threw", {
            error: String(cleanupError),
          });
        }

        setError(
          "The code worked, but we could not finish signing you in. Please try again.",
        );
        setIsVerifying(false);
        return;
      }

      router.replace(nextPath);
    } catch (err) {
      logAuthDebug("verify-flow-failed", { error: String(err) });
      setError("We could not verify that code in time. Please try again.");
      setIsVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    setError("");
    setIsLoading(true);
    setOtp("");

    try {
      const supabase = await getOrCreateLoginSupabaseClient(
        loginSupabasePromiseRef,
      );

      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      });

      if (authError) {
        setError(mapAuthError(authError));
      } else {
        setResendCooldown(60);
      }
    } catch {
      setError("We could not send a new code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (showWaitlistPrompt) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <Card variant="elevated" padding="lg" className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-orange/15 mb-4">
              <UserPlus className="h-6 w-6 text-accent-orange" />
            </div>
            <h1 className="text-heading text-text-primary">
              Request beta access
            </h1>
            <p className="text-body-sm text-text-secondary mt-2">
              <strong className="text-text-primary">{email}</strong> is not
              approved yet.
            </p>
            <p className="text-body-xs text-text-tertiary mt-2">
              Request access and tell us how you plan to use PublisherIQ.
            </p>
            <div className="flex flex-col gap-3 mt-6 w-full">
              <Link href={`/waitlist?email=${encodeURIComponent(email)}`}>
                <Button variant="primary" size="lg" className="w-full">
                  Request access
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowWaitlistPrompt(false);
                  setEmail("");
                }}
              >
                Use another email
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // OTP entry form (shown after email submitted)
  if (otpSent) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <Card variant="elevated" padding="lg" className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-blue mb-4">
              <KeyRound className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-heading text-text-primary">Check your email</h1>
            <p className="text-body-sm text-text-secondary mt-2">
              Enter the 8-digit code we sent to{" "}
              <strong className="text-text-primary">{email}</strong>
            </p>
          </div>

          <form onSubmit={handleVerifyOtp} className="mt-6 space-y-4">
            <Input
              ref={otpInputRef}
              type="text"
              label="8-digit code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              placeholder="12345678"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              error={error}
              className="text-center text-2xl tracking-[0.5em] font-mono"
              autoComplete="one-time-code"
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={isVerifying}
              className="w-full"
              disabled={otp.length !== 8 || isVerifying}
            >
              {isVerifying ? "Signing you in..." : "Sign in"}
            </Button>
          </form>

          <div className="mt-4 flex flex-col items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResendOtp}
              disabled={isLoading || resendCooldown > 0}
            >
              {isLoading
                ? "Sending new code..."
                : resendCooldown > 0
                  ? `Send a new code (${resendCooldown}s)`
                  : "Send a new code"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOtpSent(false);
                setOtp("");
                setEmail("");
                setError("");
                setResendCooldown(0);
              }}
            >
              Use another email
            </Button>
          </div>

          <p className="text-body-xs text-text-tertiary mt-4 text-center">
            Your code expires after 10 minutes.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <Card variant="elevated" padding="lg" className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-blue mb-4">
            <Gamepad2 className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-heading text-text-primary">
            Sign in to PublisherIQ
          </h1>
          <p className="text-body-sm text-text-secondary mt-1 text-center">
            Enter your approved work email and we&apos;ll send an 8-digit code.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            label="Work email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            leftIcon={<Mail className="h-4 w-4" />}
            error={error}
            autoFocus
            required
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isLoading}
            className="w-full"
            disabled={!email}
          >
            {isLoading ? "Emailing your code..." : "Email me a code"}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-body-xs text-text-tertiary">
            Need access first?{" "}
            <Link href="/waitlist" className="text-accent-blue hover:underline">
              Request access
            </Link>
          </p>
        </div>
      </Card>
    </div>
  );
}

function LoginLoadingFallback() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <Card variant="elevated" padding="lg" className="w-full max-w-sm">
        <div className="flex flex-col items-center">
          <Loader2 className="h-8 w-8 text-accent-blue animate-spin mb-4" />
          <p className="text-body-sm text-text-secondary">
            Preparing sign-in...
          </p>
        </div>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoadingFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}
