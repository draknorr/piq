import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const NEXT_FEST_ACCESS_COOKIE = "piq_next_fest_access";
export const NEXT_FEST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const ACCESS_SCOPE = "publisheriq-next-fest-v1";

function getCredentials(): { password: string; secret: string } | null {
  const password = process.env.NEXT_FEST_PASSWORD;
  const secret = process.env.NEXT_FEST_COOKIE_SECRET;
  return password && secret ? { password, secret } : null;
}

function digest(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

function safeCompare(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isNextFestConfigured(): boolean {
  return getCredentials() !== null;
}

export function isNextFestPasswordValid(candidate: string): boolean {
  const credentials = getCredentials();
  if (!credentials) return false;
  const { password, secret } = credentials;
  return safeCompare(
    digest(`${ACCESS_SCOPE}:password:${candidate}`, secret),
    digest(`${ACCESS_SCOPE}:password:${password}`, secret),
  );
}

export function createNextFestAccessToken(nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const credentials = getCredentials();
  if (!credentials) return null;
  const { password, secret } = credentials;
  const expires = nowSeconds + NEXT_FEST_COOKIE_MAX_AGE_SECONDS;
  const signature = digest(`${ACCESS_SCOPE}:cookie:${expires}:${password}`, secret).toString("hex");
  return `${expires}.${signature}`;
}

export function isNextFestAccessTokenValid(
  value: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const credentials = getCredentials();
  if (!credentials || !value || !/^\d{10}\.[a-f0-9]{64}$/.test(value)) return false;
  const [expiresValue, signature] = value.split(".");
  const expires = Number(expiresValue);
  if (expires <= nowSeconds || expires > nowSeconds + NEXT_FEST_COOKIE_MAX_AGE_SECONDS) return false;
  const expected = digest(
    `${ACCESS_SCOPE}:cookie:${expires}:${credentials.password}`,
    credentials.secret,
  ).toString("hex");
  return safeCompare(Buffer.from(signature), Buffer.from(expected));
}

export function getNextFestCookieOptions(): {
  httpOnly: true;
  maxAge: number;
  path: string;
  sameSite: "lax";
  secure: boolean;
} {
  return {
    httpOnly: true,
    maxAge: NEXT_FEST_COOKIE_MAX_AGE_SECONDS,
    path: "/next-fest",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
}
