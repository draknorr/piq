import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const REPORTS_ACCESS_COOKIE = "piq_reports_access";
export const REPORTS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const REPORTS_ACCESS_SCOPE = "publisheriq-reports-v1";

function getRequiredEnvValue(name: "REPORTS_PASSWORD" | "REPORTS_COOKIE_SECRET"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getReportsCookieSecret(): string | null {
  return getRequiredEnvValue("REPORTS_COOKIE_SECRET") ?? getReportsPassword();
}

function createDigest(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

function safeCompare(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function getReportsPassword(): string | null {
  return getRequiredEnvValue("REPORTS_PASSWORD");
}

export function areReportsConfigured(): boolean {
  return Boolean(getReportsPassword() && getReportsCookieSecret());
}

export function isReportsPasswordValid(candidate: string): boolean {
  const password = getReportsPassword();
  const secret = getReportsCookieSecret();

  if (!password || !secret) {
    return false;
  }

  return safeCompare(
    createDigest(`${REPORTS_ACCESS_SCOPE}:password:${candidate}`, secret),
    createDigest(`${REPORTS_ACCESS_SCOPE}:password:${password}`, secret),
  );
}

export function createReportsAccessToken(): string | null {
  const password = getReportsPassword();
  const secret = getReportsCookieSecret();

  if (!password || !secret) {
    return null;
  }

  return createDigest(`${REPORTS_ACCESS_SCOPE}:cookie:${password}`, secret).toString("hex");
}

export function isReportsAccessTokenValid(value: string | undefined): boolean {
  const token = createReportsAccessToken();

  if (!token || !value) {
    return false;
  }

  return safeCompare(Buffer.from(value), Buffer.from(token));
}

export function getReportsCookieOptions() {
  return {
    httpOnly: true,
    maxAge: REPORTS_COOKIE_MAX_AGE_SECONDS,
    path: "/reports",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
