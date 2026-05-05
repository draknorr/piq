import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const distDir = process.env.PUBLISHERIQ_NEXT_DIST_DIR?.trim();

const nextConfig = {
  ...(distDir ? { distDir } : {}),
  transpilePackages: ['@publisheriq/database'],
};

const sentryUploadEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT
);

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  release: {
    create: sentryUploadEnabled,
    name: process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  },
  silent: process.env.SENTRY_DEBUG !== 'true',
  sourcemaps: {
    disable: !sentryUploadEnabled,
  },
  telemetry: false,
  tunnelRoute: '/_piq/ingest',
  webpack: {
    treeshake: {
      excludeReplayIframe: true,
      excludeReplayShadowDOM: true,
      removeDebugLogging: true,
    },
  },
});
