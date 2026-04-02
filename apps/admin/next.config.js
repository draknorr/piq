/** @type {import('next').NextConfig} */
const distDir = process.env.PUBLISHERIQ_NEXT_DIST_DIR?.trim();

const nextConfig = {
  ...(distDir ? { distDir } : {}),
  transpilePackages: ['@publisheriq/database'],
};

export default nextConfig;
