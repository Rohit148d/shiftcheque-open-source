/**
 * The design system (spec 87).
 *
 * Every screen is built from these components so spacing, contrast, touch
 * targets and motion stay consistent. Components take a `theme` from context
 * rather than hard-coded colours.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DATE_EXAMPLE, DATE_FORMAT_HINT } from '../core/dateInput.ts';
import { MIN_TOUCH_SIZE, fontSizes, radius, spacing, tabularNums, type Theme } from './theme.ts';
import { useAppUi } from './AppUi.tsx';

export type IconName = keyof typeof Ionicons.glyphMap;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  contentStyle,
  testID,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppUi();
  const insets = useSafeAreaInsets();
  const body = { padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.md } as ViewStyle;
  if (!scroll) {
    return (
      <View testID={testID} style={[{ flex: 1, backgroundColor: theme.colors.background }, contentStyle]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      testID={testID}
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[body, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  accent,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  accent?: boolean;
}) {
  const { theme } = useAppUi();
  const cardStyle: StyleProp<ViewStyle> = [
    styles.card,
    {
      backgroundColor: accent ? theme.colors.accentSoft : theme.colors.surface,
      borderColor: accent ? theme.colors.accent : theme.colors.border,
    },
    style,
  ];
  if (!onPress) return <View style={cardStyle}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [cardStyle, pressed && { opacity: 0.85 }]}
    >
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  const { theme } = useAppUi();
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>{children}</Text>
      {action}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const { theme } = useAppUi();
  return <Text style={[styles.title, { color: theme.colors.text }, style]}>{children}</Text>;
}

export function Body({
  children,
  style,
  muted,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  muted?: boolean;
  numberOfLines?: number;
}) {
  const { theme } = useAppUi();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[styles.body, { color: muted ? theme.colors.textMuted : theme.colors.text }, style]}
    >
      {children}
    </Text>
  );
}

export function Caption({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const { theme } = useAppUi();
  return <Text style={[styles.caption, { color: theme.colors.textMuted }, style]}>{children}</Text>;
}

/** Money / hours display with tabular figures. */
export function Numeral({
  children,
  size = 'display',
  style,
  tone,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  size?: 'display' | 'hero' | 'heading' | 'body' | 'small';
  style?: StyleProp<TextStyle>;
  tone?: 'default' | 'positive' | 'attention' | 'danger' | 'muted';
  accessibilityLabel?: string;
}) {
  const { theme } = useAppUi();
  const sizeMap = {
    hero: fontSizes.hero,
    display: fontSizes.display,
    heading: fontSizes.heading,
    body: fontSizes.body,
    small: fontSizes.small,
  } as const;
  const colour =
    tone === 'positive'
      ? theme.colors.positive
      : tone === 'attention'
        ? theme.colors.attention
        : tone === 'danger'
          ? theme.colors.danger
          : tone === 'muted'
            ? theme.colors.textMuted
            : theme.colors.text;
  return (
    <Text
      style={[tabularNums, { fontSize: sizeMap[size], fontWeight: '700', color: colour }, style]}
      allowFontScaling
      maxFontSizeMultiplier={1.6}
      // Money must never split across two lines: shrink to fit instead of wrapping.
      numberOfLines={1}
      adjustsFontSizeToFit={size === 'hero' || size === 'display' || size === 'heading'}
      minimumFontScale={0.55}
      accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  fullWidth = true,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
}) {
  const { theme } = useAppUi();
  const background =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'secondary'
        ? theme.colors.surfaceAlt
        : variant === 'danger'
          ? theme.colors.danger
          : 'transparent';
  const textColour =
    variant === 'primary' || variant === 'danger' ? theme.colors.accentText : theme.colors.text;
  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: variant === 'ghost' ? 'transparent' : background,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColour} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={textColour} /> : null}
          <Text style={[styles.buttonLabel, { color: textColour }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  tint,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  tint?: string;
}) {
  const { theme } = useAppUi();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: theme.colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={20} color={tint ?? theme.colors.text} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const { theme } = useAppUi();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[styles.fieldLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      {children}
      {hint && !error ? <Text style={[styles.caption, { color: theme.colors.textFaint }]}>{hint}</Text> : null}
      {error ? <Text style={[styles.caption, { color: theme.colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

export function Input({ style, ...props }: TextInputProps & { style?: StyleProp<TextStyle> }) {
  const { theme } = useAppUi();
  return (
    <TextInput
      {...props}
      placeholderTextColor={theme.colors.textFaint}
      style={[
        styles.input,
        { backgroundColor: theme.colors.surfaceAlt, color: theme.colors.text, borderColor: theme.colors.border },
        style,
      ]}
      accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
    />
  );
}

/**
 * Date field with an unmistakable format.
 *
 * The format line stays on screen while the user types (it is not only in the
 * placeholder), the example is always visible, and validation errors appear
 * inline underneath without clearing what was typed.
 */
export function DateInput({
  label,
  help,
  value,
  onChangeText,
  error,
  example = DATE_EXAMPLE,
  format = DATE_FORMAT_HINT,
  autoFocus,
  testID,
}: {
  label: string;
  help?: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  example?: string;
  format?: string;
  autoFocus?: boolean;
  testID?: string;
}) {
  const { theme } = useAppUi();
  const hasError = Boolean(error);
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>{label}</Text>
      {help ? <Text style={[styles.caption, { color: theme.colors.textMuted }]}>{help}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          minHeight: MIN_TOUCH_SIZE,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: hasError ? theme.colors.danger : theme.colors.border,
          backgroundColor: theme.colors.surfaceAlt,
        }}
      >
        <Text style={[styles.caption, { color: theme.colors.textMuted, fontWeight: '700' }]}>Format:</Text>
        <Text style={[styles.caption, tabularNums, { color: theme.colors.text, fontWeight: '700' }]}>{format}</Text>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          placeholder={format}
          placeholderTextColor={theme.colors.textFaint}
          accessibilityLabel={label}
          accessibilityHint={help ? `${help} Format ${format}, for example ${example}` : `Format ${format}`}
          style={[styles.dateInput, tabularNums, { color: theme.colors.text }]}
        />
      </View>
      <Text style={[styles.caption, { color: theme.colors.textFaint }]}>
        Example: <Text style={[tabularNums, { color: theme.colors.textMuted, fontWeight: '600' }]}>{example}</Text>
      </Text>
      {hasError ? (
        <Text
          style={[styles.caption, { color: theme.colors.danger, fontWeight: '600' }]}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function MoneyInput({  value,
  onChangeText,
  label,
  hint,
  error,
  autoFocus,
}: {
  value: string;
  onChangeText: (value: string) => void;
  label: string;
  hint?: string;
  error?: string;
  autoFocus?: boolean;
}) {
  const { theme } = useAppUi();
  return (
    <Field label={label} hint={hint} error={error}>
      <View style={[styles.moneyRow, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
        <Text style={[tabularNums, { color: theme.colors.textMuted, fontSize: fontSizes.title }]}>$</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          accessibilityLabel={label}
          placeholder="0.00"
          placeholderTextColor={theme.colors.textFaint}
          style={[styles.moneyInput, tabularNums, { color: theme.colors.text }]}
        />
      </View>
    </Field>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  const { theme } = useAppUi();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={[styles.segmented, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={option.disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: Boolean(option.disabled) }}
            accessibilityLabel={option.label}
            style={[
              styles.segment,
              selected && { backgroundColor: theme.colors.surface },
              option.disabled && { opacity: 0.4 },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.segmentLabel,
                { color: selected ? theme.colors.text : theme.colors.textMuted, fontWeight: selected ? '600' : '500' },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  const { theme } = useAppUi();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.colors.accentSoft : theme.colors.surfaceAlt,
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? theme.colors.accent : theme.colors.textMuted} /> : null}
      <Text style={[styles.chipLabel, { color: selected ? theme.colors.accent : theme.colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function SwitchRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { theme } = useAppUi();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      accessibilityHint={description}
      style={[styles.switchRow, { borderColor: theme.colors.border }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.body, { color: theme.colors.text }]}>{label}</Text>
        {description ? <Text style={[styles.caption, { color: theme.colors.textMuted }]}>{description}</Text> : null}
      </View>
      <View
        style={[
          styles.switchTrack,
          { backgroundColor: value ? theme.colors.accent : theme.colors.border },
        ]}
      >
        <View style={[styles.switchThumb, { transform: [{ translateX: value ? 18 : 2 }], backgroundColor: theme.colors.surface }]} />
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export function BreakdownRow({
  label,
  detail,
  value,
  minutes,
  emphasis,
  onPress,
  tone,
  expanded,
  children,
}: {
  label: string;
  detail?: string;
  value?: string;
  minutes?: string;
  emphasis?: 'subtotal' | 'total' | 'normal';
  onPress?: () => void;
  tone?: 'default' | 'positive' | 'danger';
  expanded?: boolean;
  children?: React.ReactNode;
}) {
  const { theme } = useAppUi();
  const strong = emphasis === 'total' || emphasis === 'subtotal';
  const borderTop = emphasis === 'total';
  const content = (
    <View style={[styles.row, borderTop && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, paddingTop: spacing.md }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.body, { color: theme.colors.text, fontWeight: strong ? '700' : '500' }]}>
          {label}
        </Text>
        {detail ? <Text style={[styles.caption, { color: theme.colors.textMuted }]}>{detail}</Text> : null}
        {minutes ? <Text style={[styles.caption, tabularNums, { color: theme.colors.textFaint }]}>{minutes}</Text> : null}
        {expanded && children ? <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>{children}</View> : null}
      </View>
      {value ? (
        <Numeral
          size={strong ? 'heading' : 'body'}
          tone={tone === 'positive' ? 'positive' : tone === 'danger' ? 'danger' : 'default'}
          style={{ textAlign: 'right' }}
        >
          {value}
        </Numeral>
      ) : null}
      {onPress ? <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.textFaint} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: Boolean(expanded) }}>
      {content}
    </Pressable>
  );
}

export function ComparisonRow({
  label,
  expected,
  actual,
  status,
  unit,
}: {
  label: string;
  expected: string;
  actual: string;
  status: 'match' | 'close' | 'differs' | 'missing_expected' | 'missing_actual' | 'not_comparable';
  unit: 'money' | 'minutes';
}) {
  const { theme } = useAppUi();
  const icon: IconName = status === 'match' ? 'checkmark-circle' : status === 'differs' ? 'alert-circle' : 'help-circle';
  const colour =
    status === 'match' ? theme.colors.positive : status === 'differs' ? theme.colors.attention : theme.colors.textFaint;
  return (
    <View style={styles.comparisonRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.body, { color: theme.colors.text }]}>{label}</Text>
        <Text style={[styles.caption, tabularNums, { color: theme.colors.textMuted }]}>
          {unit === 'money' ? `${expected} / ${actual}` : `${expected} / ${actual}`}
        </Text>
      </View>
      <Ionicons name={icon} size={18} color={colour} accessibilityLabel={status} />
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  value,
  icon,
  onPress,
  accessory,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  accessory?: React.ReactNode;
}) {
  const { theme } = useAppUi();
  const content = (
    <View style={[styles.row, { paddingVertical: spacing.md }]}>
      {icon ? (
        <View style={[styles.listIcon, { backgroundColor: theme.colors.surfaceAlt }]}>
          <Ionicons name={icon} size={18} color={theme.colors.textMuted} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.body, { color: theme.colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.caption, { color: theme.colors.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {value ? <Numeral size="body" tone="muted">{value}</Numeral> : null}
      {accessory}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.colors.textFaint} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={subtitle}>
      {content}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Badge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: 'neutral' | 'positive' | 'attention' | 'danger' | 'accent';
  icon?: IconName;
}) {
  const { theme } = useAppUi();
  const background =
    tone === 'positive'
      ? theme.colors.positive
      : tone === 'attention'
        ? theme.colors.attention
        : tone === 'danger'
          ? theme.colors.danger
          : tone === 'accent'
            ? theme.colors.accent
            : theme.colors.surfaceAlt;
  const colour = tone === 'neutral' ? theme.colors.textMuted : theme.colors.accentText;
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      {icon ? <Ionicons name={icon} size={12} color={colour} /> : null}
      <Text style={[styles.badgeLabel, { color: colour }]}>{label}</Text>
    </View>
  );
}

export function ConfidenceBadge({ level, onPress }: { level: 'basic' | 'good' | 'high'; onPress?: () => void }) {
  const { t } = useAppUi();
  const tone = level === 'high' ? 'positive' : level === 'good' ? 'accent' : 'attention';
  const label = level === 'high' ? t('confidence.high') : level === 'good' ? t('confidence.good') : t('confidence.basic');
  const badge = <Badge label={`${t('app.estimateLabel')} • ${label}`} tone={tone} icon="information-circle-outline" />;
  if (!onPress) return badge;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('confidence.whatWeKnow')}>
      {badge}
    </Pressable>
  );
}

export function Banner({
  title,
  body,
  tone = 'info',
  action,
  onDismiss,
  icon,
}: {
  title?: string;
  body: string;
  tone?: 'info' | 'attention' | 'positive' | 'danger';
  action?: { label: string; onPress: () => void };
  onDismiss?: () => void;
  icon?: IconName;
}) {
  const { theme } = useAppUi();
  const accentColour =
    tone === 'attention'
      ? theme.colors.attention
      : tone === 'positive'
        ? theme.colors.positive
        : tone === 'danger'
          ? theme.colors.danger
          : theme.colors.info;
  return (
    <View style={[styles.banner, { backgroundColor: theme.colors.surfaceAlt, borderColor: accentColour }]}>
      <Ionicons name={icon ?? 'information-circle-outline'} size={18} color={accentColour} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[styles.body, { color: theme.colors.text, fontWeight: '600' }]}>{title}</Text> : null}
        <Text style={[styles.caption, { color: theme.colors.textMuted }]}>{body}</Text>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} style={{ paddingTop: spacing.xs }}>
            <Text style={[styles.caption, { color: accentColour, fontWeight: '600' }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {onDismiss ? <IconButton icon="close" onPress={onDismiss} accessibilityLabel="Dismiss" /> : null}
    </View>
  );
}

export function EmptyState({  icon = 'calendar-outline',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  const { theme } = useAppUi();
  return (
    <Card style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl }}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.colors.surfaceAlt }]}>
        <Ionicons name={icon} size={26} color={theme.colors.textMuted} />
      </View>
      <Text style={[styles.title, { color: theme.colors.text, textAlign: 'center' }]}>{title}</Text>
      <Text style={[styles.body, { color: theme.colors.textMuted, textAlign: 'center' }]}>{body}</Text>
      {action ? <Button label={action.label} onPress={action.onPress} fullWidth={false} /> : null}
    </Card>
  );
}

export function ErrorState({ title, body, onRetry }: { title?: string; body: string; onRetry?: () => void }) {
  const { theme } = useAppUi();
  const { t } = useAppUi();
  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <Ionicons name="cloud-offline-outline" size={20} color={theme.colors.attention} />
        <Text style={[styles.body, { color: theme.colors.text, fontWeight: '600' }]}>{title ?? t('error.generic')}</Text>
      </View>
      <Text style={[styles.caption, { color: theme.colors.textMuted }]}>{body}</Text>
      {onRetry ? <Button label={t('app.retry')} variant="secondary" onPress={onRetry} fullWidth={false} /> : null}
    </Card>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | `${number}%` }) {  const { theme } = useAppUi();
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{ height, width, borderRadius: radius.sm, backgroundColor: theme.colors.surfaceAlt, opacity }}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    />
  );
}

/**
 * Floating "Add Shift" button. Lives in the design system so screens import it
 * without depending on route files.
 */
export function AddShiftButton({ onPress }: { onPress?: () => void }) {
  const { theme, t } = useAppUi();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('app.addShift')}
      accessibilityHint="Opens the shift editor"
      style={({ pressed }) => ({
        position: 'absolute',
        right: spacing.lg,
        bottom: 16,
        minHeight: 52,
        minWidth: 52,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.pill,
        backgroundColor: theme.colors.accent,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        opacity: pressed ? 0.85 : 1,
        elevation: 4,
      })}
    >
      <Ionicons name="add" size={22} color={theme.colors.accentText} />
      <Text style={{ color: theme.colors.accentText, fontWeight: '700', fontSize: fontSizes.body }}>
        {t('app.addShift')}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet (modal)
// ---------------------------------------------------------------------------

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  primaryAction,
  secondaryAction,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  primaryAction?: { label: string; onPress: () => void };
  secondaryAction?: { label: string; onPress: () => void };
}) {
  const { theme } = useAppUi();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      translateY.setValue(40);
      opacity.setValue(0);
    }
  }, [visible, opacity, translateY]);

  if (!visible) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]} accessibilityViewIsModal>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View
        style={{
          backgroundColor: theme.colors.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.md,
          transform: [{ translateY }],
          opacity,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {title ? <Title>{title}</Title> : <View />}
          <IconButton icon="close" onPress={onClose} accessibilityLabel="Close" />
        </View>
        {children}
        {primaryAction ? <Button label={primaryAction.label} onPress={primaryAction.onPress} /> : null}
        {secondaryAction ? (
          <Button label={secondaryAction.label} variant="ghost" onPress={secondaryAction.onPress} />
        ) : null}
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Domain-specific cards
// ---------------------------------------------------------------------------

export function Metric({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'attention' | 'danger';
  icon?: IconName;
}) {
  const { theme } = useAppUi();
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
        {icon ? <Ionicons name={icon} size={12} color={theme.colors.textMuted} /> : null}
        <Text numberOfLines={1} style={[styles.caption, { color: theme.colors.textMuted, flexShrink: 1 }]}>
          {label}
        </Text>
      </View>
      <Numeral size="heading" tone={tone ?? 'default'} style={{ flexShrink: 1 }}>
        {value}
      </Numeral>
    </View>
  );
}

export function StatPill({ label, value }: { label: string; value: string }) {
  const { theme } = useAppUi();
  return (
    <View style={[styles.statPill, { backgroundColor: theme.colors.surfaceAlt }]}>
      <Text style={[styles.caption, { color: theme.colors.textMuted }]}>{label}</Text>
      <Numeral size="small">{value}</Numeral>
    </View>
  );
}

export function RuleSourceCard({
  title,
  publisher,
  url,
  lastVerified,
  status,
}: {
  title: string;
  publisher: string;
  url: string;
  lastVerified: string;
  status: 'verified' | 'proposed' | 'superseded' | 'custom' | 'unverified' | 'unsupported';
}) {
  const { theme } = useAppUi();
  const tone = status === 'verified' ? theme.colors.positive : status === 'superseded' ? theme.colors.textMuted : theme.colors.attention;
  return (
    <View style={[styles.row, { alignItems: 'flex-start', paddingVertical: spacing.md }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.body, { color: theme.colors.text, fontWeight: '600' }]}>{title}</Text>
        <Text style={[styles.caption, { color: theme.colors.textMuted }]}>{publisher}</Text>
        <Text style={[styles.caption, { color: theme.colors.textFaint }]}>{url}</Text>
        <Text style={[styles.caption, { color: theme.colors.textFaint }]}>
          {status} • verified {lastVerified}
        </Text>
      </View>
      <Ionicons name="shield-checkmark-outline" size={18} color={tone} />
    </View>
  );
}

export function PaywallCard({
  title,
  tagline,
  features,
  priceLabel,
  onPurchase,
  onContinueFree,
  onRestore,
  onManage,
  busy,
  notice,
}: {
  title: string;
  tagline: string;
  features: string[];
  priceLabel: string | null;
  onPurchase: () => void;
  onContinueFree: () => void;
  onRestore: () => void;
  onManage?: () => void;
  busy?: boolean;
  notice?: string;
}) {
  const { theme } = useAppUi();
  const { t } = useAppUi();
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <Title style={{ fontSize: fontSizes.heading }}>{title}</Title>
        <Body muted>{tagline}</Body>
      </View>
      <Card style={{ gap: spacing.sm }}>
        {features.map((feature) => (
          <View key={feature} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={18} color={theme.colors.positive} />
            <Body>{feature}</Body>
          </View>
        ))}
      </Card>
      {notice ? <Banner body={notice} tone="attention" /> : null}
      <Button
        label={priceLabel ? `${t('paywall.cta')} — ${priceLabel}` : t('paywall.cta')}
        onPress={onPurchase}
        loading={busy}
      />
      <Button label={t('paywall.continueFree')} variant="ghost" onPress={onContinueFree} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressable onPress={onRestore} accessibilityRole="button" accessibilityLabel={t('paywall.restore')}>
          <Text style={[styles.caption, { color: theme.colors.textMuted, textDecorationLine: 'underline' }]}>{t('paywall.restore')}</Text>
        </Pressable>
        {onManage ? (
          <Pressable onPress={onManage} accessibilityRole="button" accessibilityLabel={t('paywall.manage')}>
            <Text style={[styles.caption, { color: theme.colors.textMuted, textDecorationLine: 'underline' }]}>{t('paywall.manage')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: fontSizes.heading, fontWeight: '700' },
  body: { fontSize: fontSizes.body, lineHeight: 21 },
  caption: { fontSize: fontSizes.caption, lineHeight: 17 },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: fontSizes.small, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  button: {
    minHeight: MIN_TOUCH_SIZE,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  buttonLabel: { fontSize: fontSizes.body, fontWeight: '600' },
  iconButton: {
    width: MIN_TOUCH_SIZE,
    height: MIN_TOUCH_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: { fontSize: fontSizes.small, fontWeight: '600' },
  input: {
    minHeight: MIN_TOUCH_SIZE,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    fontSize: fontSizes.body,
  },
  moneyRow: {
    minHeight: MIN_TOUCH_SIZE + 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  moneyInput: { flex: 1, fontSize: fontSizes.heading, paddingVertical: spacing.sm },
  dateInput: { flex: 1, fontSize: fontSizes.title, paddingVertical: spacing.sm, textAlign: 'left' },
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  segmentLabel: { fontSize: fontSizes.caption },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: { fontSize: fontSizes.small, fontWeight: '500' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TOUCH_SIZE,
  },
  switchTrack: { width: 40, height: 22, borderRadius: radius.pill, justifyContent: 'center' },
  switchThumb: { width: 18, height: 18, borderRadius: radius.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  listIcon: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeLabel: { fontSize: 11, fontWeight: '700' },
  banner: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    alignItems: 'flex-start',
  },
  emptyIcon: { width: 52, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  statPill: { flex: 1, borderRadius: radius.md, padding: spacing.sm, gap: 2 },
});

export { styles as componentStyles };
