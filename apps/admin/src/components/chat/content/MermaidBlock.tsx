'use client';

import { useEffect, useRef, useState, useId } from 'react';

interface MermaidBlockProps {
  chart: string;
}

// Lazy load mermaid to reduce bundle size
let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
let mermaidInitialized = false;

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      if (!mermaidInitialized) {
        mod.default.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            primaryColor: '#e07d75',
            primaryTextColor: '#f4f4f5',
            primaryBorderColor: '#36363e',
            lineColor: '#6e6e78',
            secondaryColor: '#222228',
            tertiaryColor: '#1a1a1f',
            background: '#131316',
            mainBkg: '#1a1a1f',
            nodeBorder: '#36363e',
          },
          flowchart: {
            useMaxWidth: true,
            curve: 'basis',
          },
          sequence: {
            useMaxWidth: true,
            actorMargin: 50,
          },
        });
        mermaidInitialized = true;
      }
      return mod;
    });
  }
  return mermaidPromise;
}

export function MermaidBlock({ chart }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const uniqueId = useId().replace(/:/g, '-');

  useEffect(() => {
    let mounted = true;

    async function renderChart() {
      if (!chart.trim()) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const { default: mermaid } = await getMermaid();

        // Validate the syntax first
        const isValid = await mermaid.parse(chart.trim());
        if (!isValid) {
          throw new Error('Invalid mermaid syntax');
        }

        const id = `mermaid-${uniqueId}-${Date.now()}`;
        const { svg: renderedSvg } = await mermaid.render(id, chart.trim());

        if (mounted) {
          setSvg(renderedSvg);
        }
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : 'Failed to render diagram';
          setError(message);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    renderChart();

    return () => {
      mounted = false;
    };
  }, [chart, uniqueId]);

  if (isLoading) {
    return (
      <div className="my-3 p-4 rounded-lg border border-border-subtle bg-surface-elevated">
        <div className="flex items-center gap-2 text-text-muted">
          <div className="w-4 h-4 rounded-full border-2 border-accent-primary border-t-transparent animate-spin" />
          <span className="text-body-sm">Rendering diagram...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="my-3 p-4 rounded-lg border border-accent-red/20 bg-accent-red/5">
        <p className="text-body-sm text-accent-red mb-2">Diagram error: {error}</p>
        <pre className="text-caption text-text-muted font-mono overflow-x-auto whitespace-pre-wrap">
          {chart}
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-3 p-4 rounded-lg border border-border-subtle bg-surface-elevated overflow-x-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
