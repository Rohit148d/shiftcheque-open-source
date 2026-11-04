/**
 * Theme + i18n context and formatting hooks.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { formatClock, formatDay, formatMoney as formatMoneyI18n, formatNumber, LANGUAGES, createTranslator, type Language, type Translator } from '../i18n/index.ts';
import { themeById, type Theme } from './theme.ts';
import { useAppStore } from '../state/store.ts';

type AppUiContextValue = {
  theme: Theme;
  language: Language;
  t: Translator;
  money: (value: bigint, options?: { cents?: boolean }) => string;
  signedMoney: (value: bigint, options?: { cents?: boolean }) => string;
  hours: (minutes: number) => string;
  number: (value: number, digits?: number) => string;
  day: (dateKey: string, style?: 'short' | 'long' | 'weekday') => string;
  clock: (clock: string) => string;
  isPro: boolean;
  reducedMotion: boolean;
};

const AppUiContext = createContext<AppUiContextValue | null>(null);

export function AppUiProvider({
  children,
  reducedMotion = false,
}: {
  children: React.ReactNode;
  reducedMotion?: boolean;
}) {
  const systemScheme = useColorScheme();
  const themeId = useAppStore((state) => state.settings.themeId);
  const followSystem = useAppStore((state) => state.settings.followSystemTheme);
  const languageSetting = useAppStore((state) => state.settings.language);
  const isPro = useAppStore((state) => state.entitlement.isPro);

  const language: Language = languageSetting === 'system' ? 'en-CA' : languageSetting;
  const theme = useMemo(() => {
    if (followSystem) return systemScheme === 'dark' ? themeById('system_dark', true) : themeById(themeId === 'system_dark' ? 'maple' : themeId, false);
    return themeById(themeId, systemScheme === 'dark');
  }, [followSystem, systemScheme, themeId]);

  const value = useMemo<AppUiContextValue>(() => {
    const t = createTranslator(language);
    return {
      theme,
      language,
      t,
      money: (amount, options) => formatMoneyI18n(amount, language, options),
      signedMoney: (amount, options) => `${amount > 0n ? '+' : ''}${formatMoneyI18n(amount, language, options)}`,
      hours: (minutes) => {
        const hours = minutes / 60;
        const digits = Number.isInteger(hours) ? 0 : hours * 10 % 1 === 0 ? 1 : 2;
        return `${formatNumber(hours, language, digits)}`;
      },
      number: (value, digits) => formatNumber(value, language, digits ?? 0),
      day: (dateKey, style) => formatDay(dateKey, language, style),
      clock: (value) => formatClock(value),
      isPro,
      reducedMotion,
    };
  }, [theme, language, isPro, reducedMotion]);

  return <AppUiContext.Provider value={value}>{children}</AppUiContext.Provider>;
}

export function useAppUi(): AppUiContextValue {
  const context = useContext(AppUiContext);
  if (!context) throw new Error('useAppUi must be used inside AppUiProvider');
  return context;
}

export function useTheme(): Theme {
  return useAppUi().theme;
}

export function useT(): Translator {
  return useAppUi().t;
}

export { LANGUAGES };
