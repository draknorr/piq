/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Color palette using CSS variables for dual theme support
      colors: {
        // Surface hierarchy
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
          elevated: 'var(--surface-elevated)',
          overlay: 'var(--surface-overlay)',
          sunken: 'var(--surface-sunken)',
        },
        // Border hierarchy
        border: {
          subtle: 'var(--border-subtle)',
          muted: 'var(--border-muted)',
          prominent: 'var(--border-prominent)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)',
        },
        // Text hierarchy
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          muted: 'var(--text-muted)',
        },
        // Primary accent (coral)
        accent: {
          primary: 'var(--accent-primary)',
          'primary-hover': 'var(--accent-primary-hover)',
          'primary-muted': 'var(--accent-primary-muted)',
          'primary-subtle': 'var(--accent-primary-subtle)',
          // Semantic colors
          blue: 'var(--accent-blue)',
          green: 'var(--accent-green)',
          yellow: 'var(--accent-yellow)',
          red: 'var(--accent-red)',
          purple: 'var(--accent-purple)',
          cyan: 'var(--accent-cyan)',
          orange: 'var(--accent-orange)',
          pink: 'var(--accent-pink)',
        },
        // Trend indicators
        trend: {
          positive: 'var(--trend-positive)',
          negative: 'var(--trend-negative)',
          neutral: 'var(--trend-neutral)',
        },
        // Semantic colors for status/feedback
        semantic: {
          success: 'var(--semantic-success)',
          'success-text': 'var(--semantic-success-text)',
          'success-subtle': 'var(--semantic-success-muted)',
          error: 'var(--semantic-error)',
          'error-text': 'var(--semantic-error-text)',
          'error-subtle': 'var(--semantic-error-muted)',
          warning: 'var(--semantic-warning)',
          'warning-subtle': 'var(--semantic-warning-muted)',
          info: 'var(--semantic-info)',
          'info-subtle': 'var(--semantic-info-muted)',
        },
        // Chart colors
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
          6: 'var(--chart-6)',
          grid: 'var(--chart-grid)',
          axis: 'var(--chart-axis)',
        },
      },
      // Typography
      // Uses CSS variables that fall back to Geist fonts (Phase 1 compatibility)
      fontFamily: {
        sans: ['var(--font-sans)', 'var(--font-geist-sans)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-mono)', 'var(--font-geist-mono)', 'Menlo', 'Monaco', 'monospace'],
      },
      fontSize: {
        'display-lg': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-sm': ['1.875rem', { lineHeight: '1.25', letterSpacing: '-0.02em', fontWeight: '600' }],
        'heading': ['1.5rem', { lineHeight: '1.35', letterSpacing: '-0.015em', fontWeight: '600' }],
        'heading-sm': ['1.25rem', { lineHeight: '1.4', letterSpacing: '-0.01em', fontWeight: '600' }],  // 20px
        'subheading': ['1.125rem', { lineHeight: '1.4', letterSpacing: '-0.01em', fontWeight: '500' }],
        'body-lg': ['1rem', { lineHeight: '1.6', fontWeight: '400' }],
        'body-md': ['0.9375rem', { lineHeight: '1.5', fontWeight: '400' }],  // 15px
        'body': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
        'body-sm': ['0.8125rem', { lineHeight: '1.4', fontWeight: '400' }],
        'caption': ['0.75rem', { lineHeight: '1.35', letterSpacing: '0.01em', fontWeight: '500' }],
        'caption-sm': ['0.6875rem', { lineHeight: '1.3', letterSpacing: '0.02em', fontWeight: '500' }],
      },
      // Shadows - theme-aware via CSS variables
      boxShadow: {
        'xs': 'var(--shadow-xs)',
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
        'xl': 'var(--shadow-xl)',
        'focus': 'var(--shadow-focus)',
        'inset': 'var(--shadow-inset)',
        // Legacy shadows (keep for compatibility)
        'subtle': '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
        'card': 'var(--card-shadow)',
        'elevated': '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.08)',
        'overlay': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        'glow-primary': '0 0 20px var(--accent-primary-muted)',
        'glow-green': '0 0 20px rgba(45, 138, 110, 0.15)',
        'glow-red': '0 0 20px rgba(181, 77, 66, 0.15)',
      },
      // Border radius - matches design spec
      borderRadius: {
        'none': '0',
        'sm': '0.25rem',     // 4px
        'DEFAULT': '0.375rem', // 6px
        'md': '0.375rem',    // 6px
        'lg': '0.5rem',      // 8px
        'xl': '0.75rem',     // 12px
        '2xl': '1rem',       // 16px
        'full': '9999px',
      },
      // Animation
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'fade-in-up': 'fadeInUp 300ms ease-out',
        'slide-up': 'slideUp 300ms ease-out',
        'slide-down': 'slideDown 300ms ease-out',
        'pulse-subtle': 'pulseSubtle 2s ease-in-out infinite',
        'scale-in': 'scaleIn 200ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      // Transition
      transitionDuration: {
        DEFAULT: '150ms',
      },
      // Spacing
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
    },
  },
  plugins: [],
};
