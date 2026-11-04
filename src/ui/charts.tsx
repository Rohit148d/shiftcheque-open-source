/**
 * Accessible charts (spec 85/87).
 *
 * Charts are built from plain views with explicit labels, a text summary for
 * screen readers, and no reliance on colour alone.
 */
import React from 'react';
import { Text, View } from 'react-native';

import { useAppUi } from './AppUi.tsx';
import { Caption, Card, Numeral, SectionTitle } from './components.tsx';
import { fontSizes, radius, spacing, tabularNums } from './theme.ts';

export type BarDatum = { label: string; value: number; secondary?: number; highlight?: boolean };

export function BarChart({
  data,
  title,
  valueFormatter,
  height = 120,
  summary,
}: {
  data: BarDatum[];
  title?: string;
  valueFormatter?: (value: number) => string;
  height?: number;
  summary?: string;
}) {
  const { theme } = useAppUi();
  const max = Math.max(1, ...data.map((datum) => datum.value + (datum.secondary ?? 0)));
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={summary ?? `${title ?? 'Chart'}: ${data.map((d) => `${d.label} ${valueFormatter ? valueFormatter(d.value) : d.value}`).join(', ')}`}
      style={{ gap: spacing.sm }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, height }}>
        {data.map((datum) => {
          const primaryHeight = Math.max(2, Math.round(((datum.value) / max) * (height - 20)));
          const secondaryHeight = datum.secondary ? Math.max(2, Math.round((datum.secondary / max) * (height - 20))) : 0;
          return (
            <View key={datum.label} style={{ flex: 1, alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
              <View
                style={{
                  width: '100%',
                  height: primaryHeight,
                  backgroundColor: datum.highlight ? theme.colors.accent : theme.chart[1],
                  borderRadius: radius.sm,
                }}
              />
              {secondaryHeight > 0 ? (
                <View
                  style={{
                    width: '100%',
                    height: secondaryHeight,
                    backgroundColor: theme.colors.attention,
                    borderRadius: radius.sm,
                    marginTop: -secondaryHeight - 4,
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        {data.map((datum) => (
          <View key={`${datum.label}-label`} style={{ flex: 1 }}>
            <Text style={[tabularNums, { fontSize: 10, color: theme.colors.textFaint, textAlign: 'center' }]} numberOfLines={1}>
              {datum.label}
            </Text>
          </View>
        ))}
      </View>
      {valueFormatter ? (
        <Caption style={{ textAlign: 'center' }}>
          {valueFormatter(max)} max
        </Caption>
      ) : null}
    </View>
  );
}

export function ChartCard({
  title,
  children,
  footer,
  action,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { theme } = useAppUi();
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: fontSizes.body, fontWeight: '700', color: theme.colors.text }}>{title}</Text>
        {action}
      </View>
      {children}
      {footer ? <Caption>{footer}</Caption> : null}
    </Card>
  );
}

/** Compact horizontal bars, used for the pay breakdown and premiums. */
export function StackedBar({ segments }: { segments: { label: string; value: number; colour: string }[] }) {
  const total = Math.max(1, segments.reduce((sum, segment) => sum + segment.value, 0));
  return (
    <View style={{ flexDirection: 'row', height: 10, borderRadius: radius.pill, overflow: 'hidden' }}>
      {segments.map((segment) => (
        <View
          key={segment.label}
          accessibilityLabel={`${segment.label}: ${Math.round((segment.value / total) * 100)}%`}
          style={{ flex: Math.max(segment.value / total, 0.001), backgroundColor: segment.colour }}
        />
      ))}
    </View>
  );
}

export function Legend({ items }: { items: { label: string; colour: string; value?: string }[] }) {
  const { theme } = useAppUi();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
      {items.map((item) => (
        <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: item.colour }} />
          <Caption>{item.label}</Caption>
          {item.value ? <Numeral size="small">{item.value}</Numeral> : null}
        </View>
      ))}
    </View>
  );
}

export function ProgressBar({
  progress,
  label,
  caption,
  tone = 'accent',
}: {
  progress: number;
  label: string;
  caption?: string;
  tone?: 'accent' | 'attention' | 'positive';
}) {
  const { theme } = useAppUi();
  const clamped = Math.max(0, Math.min(1, progress));
  const colour = tone === 'attention' ? theme.colors.attention : tone === 'positive' ? theme.colors.positive : theme.colors.accent;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{ gap: spacing.xs }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: fontSizes.small, color: theme.colors.text, fontWeight: '600' }}>{label}</Text>
        {caption ? <Caption>{caption}</Caption> : null}
      </View>
      <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden' }}>
        <View style={{ width: `${clamped * 100}%`, height: '100%', backgroundColor: colour, borderRadius: radius.pill }} />
      </View>
    </View>
  );
}

export { SectionTitle };
