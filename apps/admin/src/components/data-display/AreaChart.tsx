'use client';

import {
  ResponsiveContainer,
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useTheme } from '@/contexts/ThemeContext';

type ChartValue = string | number | null | undefined;

interface DataPoint {
  [key: string]: ChartValue;
}

interface TooltipPayloadItem {
  value?: ChartValue;
  name?: string | number;
}

// Chart color type
type ChartColor = 'coral' | 'green' | 'amber' | 'teal' | 'purple' | 'pink' | 'blue' | 'red' | 'cyan' | 'orange';

interface AreaChartProps {
  data: DataPoint[];
  xKey: string;
  yKey: string;
  height?: number;
  color?: ChartColor;
  showGrid?: boolean;
  showXAxis?: boolean;
  showYAxis?: boolean;
  formatXAxis?: (value: string | number) => string;
  formatYAxis?: (value: number) => string;
  formatTooltip?: (value: number) => string;
  tooltipLabel?: string;
  className?: string;
}

// Light theme colors
const lightColorMap: Record<string, { stroke: string; fill: string }> = {
  coral: { stroke: '#D4716A', fill: '#D4716A' },
  green: { stroke: '#2D8A6E', fill: '#2D8A6E' },
  amber: { stroke: '#D97706', fill: '#D97706' },
  teal: { stroke: '#0E7490', fill: '#0E7490' },
  purple: { stroke: '#7C3AED', fill: '#7C3AED' },
  pink: { stroke: '#EC4899', fill: '#EC4899' },
  // Legacy aliases
  blue: { stroke: '#0E7490', fill: '#0E7490' },
  red: { stroke: '#9C4338', fill: '#9C4338' },
  cyan: { stroke: '#D4716A', fill: '#D4716A' },
  orange: { stroke: '#D97706', fill: '#D97706' },
};

// Dark theme colors
const darkColorMap: Record<string, { stroke: string; fill: string }> = {
  coral: { stroke: '#E07D75', fill: '#E07D75' },
  green: { stroke: '#5DD4A8', fill: '#5DD4A8' },
  amber: { stroke: '#FBBF24', fill: '#FBBF24' },
  teal: { stroke: '#38BDF8', fill: '#38BDF8' },
  purple: { stroke: '#A78BFA', fill: '#A78BFA' },
  pink: { stroke: '#F472B6', fill: '#F472B6' },
  // Legacy aliases
  blue: { stroke: '#38BDF8', fill: '#38BDF8' },
  red: { stroke: '#CF7F76', fill: '#CF7F76' },
  cyan: { stroke: '#E07D75', fill: '#E07D75' },
  orange: { stroke: '#FBBF24', fill: '#FBBF24' },
};

// Theme-aware chart styling
const lightTheme = {
  grid: '#E8E4DE',
  tick: '#7A756D',
  tooltipBg: '#FFFFFF',
  tooltipBorder: '#E8E4DE',
  tooltipLabel: '#5C5752',
  tooltipText: '#2D2A26',
};

const darkTheme = {
  grid: '#332F2A',
  tick: '#8A847A',
  tooltipBg: '#211F1C',
  tooltipBorder: '#3D3935',
  tooltipLabel: '#B5B0A8',
  tooltipText: '#E8E4DE',
};

export function AreaChartComponent({
  data,
  xKey,
  yKey,
  height = 200,
  color = 'coral',
  showGrid = true,
  showXAxis = true,
  showYAxis = true,
  formatXAxis,
  formatYAxis,
  formatTooltip,
  tooltipLabel,
  className = '',
}: AreaChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const colorMap = isDark ? darkColorMap : lightColorMap;
  const theme = isDark ? darkTheme : lightTheme;

  if (!data || data.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-raised border border-border-subtle rounded-lg ${className}`}
        style={{ height }}
      >
        <span className="text-text-muted text-body-sm">No data available</span>
      </div>
    );
  }

  const { stroke, fill } = colorMap[color] || colorMap.coral;
  const formatTooltipValue = (value: ChartValue) => {
    if (value === null || value === undefined) return '—';
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) return '—';
    return formatTooltip ? formatTooltip(numericValue) : numericValue.toLocaleString();
  };
  const renderTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: TooltipPayloadItem[];
    label?: string | number;
  }) => {
    if (!active || !payload || payload.length === 0) return null;

    const item = payload[0];
    const seriesLabel = tooltipLabel ?? String(item.name || yKey);

    return (
      <div
        style={{
          backgroundColor: theme.tooltipBg,
          border: `1px solid ${theme.tooltipBorder}`,
          borderRadius: '8px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          padding: '8px 10px',
        }}
      >
        <div style={{ color: theme.tooltipLabel, marginBottom: '4px' }}>
          {label}
        </div>
        <div style={{ color: theme.tooltipText }}>
          {seriesLabel}: {formatTooltipValue(item.value)}
        </div>
      </div>
    );
  };

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={`areaGradient-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fill} stopOpacity={0.2} />
              <stop offset="100%" stopColor={fill} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.grid}
              vertical={false}
            />
          )}
          {showXAxis && (
            <XAxis
              dataKey={xKey}
              axisLine={false}
              tickLine={false}
              tick={{ fill: theme.tick, fontSize: 11 }}
              tickFormatter={formatXAxis}
              dy={8}
            />
          )}
          {showYAxis && (
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: theme.tick, fontSize: 11 }}
              tickFormatter={formatYAxis}
              width={50}
            />
          )}
          <Tooltip
            content={renderTooltip}
          />
          <Area
            type="monotone"
            dataKey={yKey}
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#areaGradient-${color})`}
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Multi-series area chart
interface MultiAreaChartProps {
  data: DataPoint[];
  xKey: string;
  series: { key: string; color: ChartColor; label?: string }[];
  height?: number;
  showGrid?: boolean;
  showXAxis?: boolean;
  showYAxis?: boolean;
  stacked?: boolean;
  formatXAxis?: (value: string | number) => string;
  formatYAxis?: (value: number) => string;
  className?: string;
}

export function MultiAreaChart({
  data,
  xKey,
  series,
  height = 200,
  showGrid = true,
  showXAxis = true,
  showYAxis = true,
  stacked = false,
  formatXAxis,
  formatYAxis,
  className = '',
}: MultiAreaChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const colorMap = isDark ? darkColorMap : lightColorMap;
  const theme = isDark ? darkTheme : lightTheme;

  if (!data || data.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-raised border border-border-subtle rounded-lg ${className}`}
        style={{ height }}
      >
        <span className="text-text-muted text-body-sm">No data available</span>
      </div>
    );
  }

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            {series.map((s) => {
              const colors = colorMap[s.color] || colorMap.coral;
              return (
                <linearGradient
                  key={s.key}
                  id={`multiGradient-${s.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={colors.fill}
                    stopOpacity={0.2}
                  />
                  <stop
                    offset="100%"
                    stopColor={colors.fill}
                    stopOpacity={0}
                  />
                </linearGradient>
              );
            })}
          </defs>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.grid}
              vertical={false}
            />
          )}
          {showXAxis && (
            <XAxis
              dataKey={xKey}
              axisLine={false}
              tickLine={false}
              tick={{ fill: theme.tick, fontSize: 11 }}
              tickFormatter={formatXAxis}
              dy={8}
            />
          )}
          {showYAxis && (
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: theme.tick, fontSize: 11 }}
              tickFormatter={formatYAxis}
              width={50}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }}
            labelStyle={{ color: theme.tooltipLabel, marginBottom: '4px' }}
          />
          {series.map((s) => {
            const colors = colorMap[s.color] || colorMap.coral;
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label || s.key}
                stroke={colors.stroke}
                strokeWidth={2}
                fill={`url(#multiGradient-${s.key})`}
                stackId={stacked ? 'stack' : undefined}
              />
            );
          })}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
