'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Activity,
  LayoutDashboard,
  Gamepad2,
  Building2,
  Users,
  Menu,
  X,
  Search,
  MessageSquare,
  Shield,
  User,
  ClipboardList,
  BarChart3,
  ChevronDown,
  TrendingUp,
  Sparkles,
  Youtube,
  type LucideIcon,
} from 'lucide-react';
import { useSidebar } from '@/contexts';
import { useGlobalSearch } from '@/components/search';
import { ThemeToggle } from '@/components/ui';
import { AlertBadge } from '@/components/alerts';
import { createBrowserClient } from '@/lib/supabase/client';
import { ReportIssueMenuButton } from '@/features/report-issue';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  children?: NavItem[];
}

const mainNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/insights', label: 'Insights', icon: TrendingUp },
  { href: '/youtube', label: 'YouTube Pulse', icon: Youtube },
  { href: '/changes', label: 'Change Feed', icon: Activity },
  { href: '/apps', label: 'Apps', icon: Gamepad2 },
  { href: '/companies?type=publisher', label: 'Publishers', icon: Building2 },
  { href: '/companies?type=developer', label: 'Developers', icon: Users },
];

const adminNavItems: NavItem[] = [
  { href: '/admin', label: 'System Status', icon: Shield },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/waitlist', label: 'Waitlist', icon: ClipboardList },
  { href: '/admin/usage', label: 'Usage', icon: BarChart3 },
  { href: '/admin/chat-smoke', label: 'Chat Smoke', icon: MessageSquare },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isOpen, toggle, close } = useSidebar();
  const { open: openSearch } = useGlobalSearch();
  const [userProfile, setUserProfile] = useState<{
    email: string;
    role: 'user' | 'admin';
  } | null>(null);
  const [adminExpanded, setAdminExpanded] = useState(false);

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    // For admin routes, only match exact or child paths
    if (href === '/admin') {
      return pathname === '/admin';
    }
    // Handle companies page with type filter
    if (href.startsWith('/companies?type=')) {
      const currentType = searchParams.get('type');
      const hrefType = new URL(href, 'http://x').searchParams.get('type');
      return pathname === '/companies' && currentType === hrefType;
    }
    return pathname.startsWith(href);
  };

  const isAdminSection = pathname.startsWith('/admin');

  // Fetch user profile
  useEffect(() => {
    // Use single client instance for both fetching and subscribing
    // This prevents multiple auth listeners and token refresh loops
    const supabase = createBrowserClient();

    const fetchProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('email, role')
            .eq('id', user.id)
            .single();

          if (profile) {
            setUserProfile(profile);
          }
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
      }
    };

    fetchProfile();

    // Subscribe using the same client instance
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchProfile();
    });

    return () => subscription.unsubscribe();
  }, []);

  // Auto-expand admin section when on admin pages
  useEffect(() => {
    if (isAdminSection) {
      setAdminExpanded(true);
    }
  }, [isAdminSection]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const isAdmin = userProfile?.role === 'admin';

  return (
    <>
      {/* Mobile header controls */}
      <div className="fixed left-4 right-4 top-safe z-50 flex items-center justify-between md:hidden">
        <button
          onClick={toggle}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-raised border border-border-subtle"
          aria-label={isOpen ? 'Close menu' : 'Open menu'}
        >
          {isOpen ? (
            <X className="h-5 w-5 text-text-primary" />
          ) : (
            <Menu className="h-5 w-5 text-text-primary" />
          )}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={openSearch}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-raised border border-border-subtle"
            aria-label="Search"
          >
            <Search className="h-5 w-5 text-text-primary" />
          </button>
          <ThemeToggle />
        </div>
      </div>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 z-40 h-screen-safe w-64 border-r border-border-subtle bg-surface-raised
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
      >
        <div className="flex h-full flex-col">
          {/* Logo + Alert Badge */}
          <div className="flex h-14 items-center justify-between border-b border-border-subtle px-5">
            <Link
              href="/dashboard"
              prefetch={false}
              className="flex items-center gap-2.5 text-text-primary transition-opacity hover:opacity-80"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-primary">
                <Gamepad2 className="h-4 w-4 text-white" />
              </div>
              <span className="text-subheading tracking-tight">PublisherIQ</span>
            </Link>
            <AlertBadge isAuthenticated={userProfile !== null} />
          </div>

          {/* Search Button */}
          <div className="px-3 py-3 border-b border-border-subtle">
            <button
              onClick={openSearch}
              className="
                w-full flex items-center gap-2.5 px-3 py-2
                bg-surface-elevated border border-border-subtle rounded-lg
                text-text-muted hover:text-text-secondary hover:border-border-muted
                transition-all duration-150
              "
            >
              <Search className="w-4 h-4" />
              <span className="flex-1 text-left text-body-sm">Search...</span>
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-caption bg-surface rounded border border-border-subtle">
                <span className="text-xs">⌘</span>K
              </kbd>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
            {/* Main nav items */}
            <div className="space-y-1">
              {mainNavItems.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    className={`
                      group relative flex items-center gap-3 rounded-lg px-3 py-2
                      text-body font-medium transition-all duration-150
                      ${
                        active
                          ? 'bg-surface-elevated text-text-primary'
                          : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                      }
                    `}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent-primary" />
                    )}
                    <Icon
                      className={`h-4 w-4 flex-shrink-0 ${
                        active ? 'text-accent-primary' : 'text-text-tertiary group-hover:text-text-secondary'
                      }`}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            {/* Account link */}
            <div className="mt-4 pt-4 border-t border-border-subtle">
              <Link
                href="/account"
                prefetch={false}
                className={`
                  group relative flex items-center gap-3 rounded-lg px-3 py-2
                  text-body font-medium transition-all duration-150
                  ${
                    isActive('/account')
                      ? 'bg-surface-elevated text-text-primary'
                      : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                  }
                `}
              >
                {isActive('/account') && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent-primary" />
                )}
                <User
                  className={`h-4 w-4 flex-shrink-0 ${
                    isActive('/account') ? 'text-accent-primary' : 'text-text-tertiary group-hover:text-text-secondary'
                  }`}
                />
                Account
              </Link>
            </div>

            {/* Admin section */}
            {isAdmin && (
              <div className="mt-4 pt-4 border-t border-border-subtle">
                <button
                  onClick={() => setAdminExpanded(!adminExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 text-body-sm font-medium text-text-secondary"
                >
                  <span>Admin</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${adminExpanded ? 'rotate-180' : ''}`}
                  />
                </button>

                {adminExpanded && (
                  <div className="space-y-1 mt-1">
                    {adminNavItems.map((item) => {
                      const active = isActive(item.href);
                      const Icon = item.icon;

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          prefetch={false}
                          className={`
                            group relative flex items-center gap-3 rounded-lg px-3 py-2 ml-2
                            text-body font-medium transition-all duration-150
                            ${
                              active
                                ? 'bg-surface-elevated text-text-primary'
                                : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                            }
                          `}
                        >
                          {active && (
                            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent-primary" />
                          )}
                          <Icon
                            className={`h-4 w-4 flex-shrink-0 ${
                              active ? 'text-accent-primary' : 'text-text-tertiary group-hover:text-text-secondary'
                            }`}
                          />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </nav>

          {/* Footer */}
          <div className="border-t border-border-subtle p-4">
            <ReportIssueMenuButton
              onOpen={close}
              className="
                mb-3 flex w-full items-center gap-2 rounded-lg border border-border-subtle
                bg-surface-elevated px-3 py-2 text-body-sm font-medium text-text-secondary
                transition-colors hover:border-border-muted hover:text-text-primary
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary
                focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised
              "
            />
            <Link
              href="/updates"
              prefetch={false}
              className="flex items-center gap-2 mb-3 text-caption text-text-muted hover:text-text-secondary transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>What&apos;s New</span>
            </Link>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-accent-green animate-pulse-subtle" />
                <p className="text-caption text-text-muted">
                  Made by{' '}
                  <a
                    href="https://www.ryanbohmann.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-secondary hover:text-text-primary transition-colors"
                  >
                    Ryan
                  </a>
                </p>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
