import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthNextPathFromUrl } from '@/lib/auth/redirects';
import {
  createJsonResponse,
  createRedirectResponse,
  updateSession,
} from '@/lib/supabase/middleware';

const AUTH_DEBUG = process.env.NEXT_PUBLIC_AUTH_DEBUG === 'true';
const CHAT_EVAL_SECRET = process.env.CHAT_EVAL_SECRET;
const CHAT_EVAL_LOCAL_BYPASS_ENABLED = process.env.CHAT_EVAL_LOCAL_BYPASS_ENABLED === 'true';
const LOCAL_BYPASS_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

// Public paths - no auth required
const PUBLIC_PATHS = [
  '/login',
  '/waitlist',
  '/auth/callback',
  '/auth/confirm',
  '/api/auth/callback',
  '/api/auth/validate-email',
];

// Admin-only paths (requires admin role)
const ADMIN_PATHS = ['/admin'];

// Static asset patterns to skip
const STATIC_PATTERNS = [
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
];

function isStaticAsset(pathname: string): boolean {
  return STATIC_PATTERNS.some((pattern) => pathname.startsWith(pattern));
}

function isPublicPath(pathname: string): boolean {
  // Landing page is public (exact match only)
  if (pathname === '/') {
    return true;
  }
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some((path) => pathname.startsWith(path));
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function isChatEvalPath(pathname: string): boolean {
  return pathname === '/api/chat/eval' || pathname === '/api/chat/stream';
}

function isLocalChatEvalBypassRequest(request: NextRequest): boolean {
  if (!CHAT_EVAL_LOCAL_BYPASS_ENABLED || !CHAT_EVAL_SECRET) {
    return false;
  }

  if (!isChatEvalPath(request.nextUrl.pathname)) {
    return false;
  }

  if (request.headers.get('x-chat-eval-secret') !== CHAT_EVAL_SECRET) {
    return false;
  }

  const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const hostCandidates = [request.nextUrl.hostname, hostHeader]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().replace(/:\d+$/, '').toLowerCase())
    .filter(Boolean);

  return hostCandidates.some((hostname) => LOCAL_BYPASS_HOSTS.has(hostname));
}

function logAuthDebug(event: string, details: Record<string, unknown>): void {
  if (!AUTH_DEBUG) {
    return;
  }

  console.info(`[auth][middleware] ${event}`, details);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.nextUrl.hostname;

  // DEV BYPASS: Skip auth on localhost for local development
  // Only enabled when NODE_ENV is explicitly 'development'
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (isLocalhost && isDevelopment && !isPublicPath(pathname) && !isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  // Redirect auth errors from / to /login with error params
  if (pathname === '/' && request.nextUrl.searchParams.has('error')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Route auth code from root to callback handler (preserves all params including origin)
  // This handles cases where Supabase redirects to root instead of callback path
  if (pathname === '/' && request.nextUrl.searchParams.has('code')) {
    const url = request.nextUrl.clone();
    url.pathname = '/api/auth/callback';
    return NextResponse.redirect(url);
  }

  // Skip static assets
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  if (isLocalChatEvalBypassRequest(request)) {
    return NextResponse.next();
  }

  // For public paths, still update session but don't require auth
  if (isPublicPath(pathname)) {
    try {
      const { response } = await updateSession(request);
      return response;
    } catch {
      return NextResponse.next();
    }
  }

  // Protected routes - require Supabase auth
  const { user, response, supabase } = await updateSession(request);
  logAuthDebug('protected-check', { hostname, pathname, hasUser: !!user });

  // Not authenticated
  if (!user) {
    // API routes get 401 JSON response (not redirect)
    if (isApiPath(pathname)) {
      return createJsonResponse(
        response,
        { error: 'unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    // Web routes get redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', getAuthNextPathFromUrl(request.nextUrl));
    logAuthDebug('redirect-login', {
      hostname,
      pathname,
      next: loginUrl.searchParams.get('next'),
    });
    return createRedirectResponse(response, loginUrl);
  }

  // Check admin access for admin paths
  if (isAdminPath(pathname)) {
    // Fetch user profile to check role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase.from('user_profiles') as any)
      .select('role')
      .eq('id', user.id)
      .single() as { data: { role: string } | null };

    if (!profile || profile.role !== 'admin') {
      // Non-admin trying to access admin routes - redirect to dashboard
      const dashboardUrl = new URL('/dashboard', request.url);
      return createRedirectResponse(response, dashboardUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
