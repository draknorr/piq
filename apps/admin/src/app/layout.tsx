import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/jetbrains-mono';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ReportIssueRoot } from '@/features/report-issue';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PublisherIQ',
    template: '%s | PublisherIQ',
  },
  description: 'Gaming industry intelligence platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

// Script to prevent theme flash on load (light mode default)
// Sets both data-theme attribute (new) and .dark class (Phase 1 compatibility)
const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('publisheriq-theme');
      var isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    } catch (e) {}
  })();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen-safe bg-surface font-sans antialiased">
        <Providers>
          <ThemeProvider>
            <ReportIssueRoot>{children}</ReportIssueRoot>
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
