/**
 * Design tokens + themes (spec 48/49/50).
 *
 * Financial numbers always use tabular figures, contrast is checked for both
 * light and dark, and themes never change semantic colours (positive/attention/
 * danger keep their meaning).
 */
import { Platform, TextStyle } from 'react-native';

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  positive: string;
  attention: string;
  danger: string;
  info: string;
  overlay: string;
};

export type Theme = {
  id: string;
  name: string;
  pro: boolean;
  dark: boolean;
  colors: ThemeColors;
  /** Chart palette, in order. */
  chart: string[];
};

export const THEMES: Theme[] = [
  {
    id: 'maple',
    name: 'Maple',
    pro: false,
    dark: false,
    colors: {
      background: '#F7F8FA',
      surface: '#FFFFFF',
      surfaceAlt: '#EFF1F5',
      border: '#E2E5EB',
      text: '#0E1B2A',
      textMuted: '#5A6472',
      textFaint: '#8B95A3',
      accent: '#D52B1E',
      accentSoft: '#FDE8E6',
      accentText: '#FFFFFF',
      positive: '#1B7F4B',
      attention: '#B26A00',
      danger: '#C0392B',
      info: '#1F5F92',
      overlay: 'rgba(14,27,42,0.45)',
    },
    chart: ['#D52B1E', '#0E1B2A', '#1B7F4B', '#B26A00', '#1F5F92'],
  },
  {
    id: 'system_light',
    name: 'System Light',
    pro: false,
    dark: false,
    colors: {
      background: '#FFFFFF',
      surface: '#FFFFFF',
      surfaceAlt: '#F2F3F5',
      border: '#DDE1E6',
      text: '#11151C',
      textMuted: '#545B66',
      textFaint: '#868E99',
      accent: '#1F5F92',
      accentSoft: '#E6F0F8',
      accentText: '#FFFFFF',
      positive: '#1B7F4B',
      attention: '#B26A00',
      danger: '#C0392B',
      info: '#1F5F92',
      overlay: 'rgba(0,0,0,0.4)',
    },
    chart: ['#1F5F92', '#0E1B2A', '#1B7F4B', '#B26A00', '#D52B1E'],
  },
  {
    id: 'system_dark',
    name: 'System Dark',
    pro: false,
    dark: true,
    colors: {
      background: '#0B1219',
      surface: '#131C26',
      surfaceAlt: '#1B2733',
      border: '#243040',
      text: '#F2F5F8',
      textMuted: '#A3AEBC',
      textFaint: '#78838F',
      accent: '#FF6B5E',
      accentSoft: '#33201F',
      accentText: '#0B1219',
      positive: '#4BC98A',
      attention: '#E0A33A',
      danger: '#FF7061',
      info: '#6FB3E0',
      overlay: 'rgba(0,0,0,0.6)',
    },
    chart: ['#FF6B5E', '#6FB3E0', '#4BC98A', '#E0A33A', '#C79BFF'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    pro: true,
    dark: true,
    colors: {
      background: '#080D1A',
      surface: '#101828',
      surfaceAlt: '#182238',
      border: '#22304A',
      text: '#EAF0FA',
      textMuted: '#9DAAC2',
      textFaint: '#71809B',
      accent: '#7AA2FF',
      accentSoft: '#16213A',
      accentText: '#080D1A',
      positive: '#4BC98A',
      attention: '#E0A33A',
      danger: '#FF7061',
      info: '#7AA2FF',
      overlay: 'rgba(0,0,0,0.65)',
    },
    chart: ['#7AA2FF', '#4BC98A', '#E0A33A', '#FF7061', '#C79BFF'],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    pro: true,
    dark: false,
    colors: {
      background: '#F2F8FB',
      surface: '#FFFFFF',
      surfaceAlt: '#E4F0F6',
      border: '#D2E3EC',
      text: '#08293A',
      textMuted: '#4A6C7C',
      textFaint: '#7A97A5',
      accent: '#0E7490',
      accentSoft: '#DCF0F6',
      accentText: '#FFFFFF',
      positive: '#1B7F4B',
      attention: '#B26A00',
      danger: '#C0392B',
      info: '#0E7490',
      overlay: 'rgba(8,41,58,0.45)',
    },
    chart: ['#0E7490', '#08293A', '#1B7F4B', '#B26A00', '#D52B1E'],
  },
  {
    id: 'forest',
    name: 'Forest',
    pro: true,
    dark: false,
    colors: {
      background: '#F4F8F3',
      surface: '#FFFFFF',
      surfaceAlt: '#E8F0E6',
      border: '#D6E2D3',
      text: '#12261A',
      textMuted: '#4E6353',
      textFaint: '#7E9184',
      accent: '#2F6B3A',
      accentSoft: '#E1EFE2',
      accentText: '#FFFFFF',
      positive: '#2F6B3A',
      attention: '#A9691A',
      danger: '#B23B2E',
      info: '#31678F',
      overlay: 'rgba(18,38,26,0.45)',
    },
    chart: ['#2F6B3A', '#12261A', '#A9691A', '#31678F', '#B23B2E'],
  },
  {
    id: 'lavender',
    name: 'Lavender',
    pro: true,
    dark: false,
    colors: {
      background: '#F8F6FC',
      surface: '#FFFFFF',
      surfaceAlt: '#EFEAF8',
      border: '#E0D9F0',
      text: '#1E1730',
      textMuted: '#5D5473',
      textFaint: '#8B82A1',
      accent: '#6D4BB5',
      accentSoft: '#EDE6FA',
      accentText: '#FFFFFF',
      positive: '#1B7F4B',
      attention: '#B26A00',
      danger: '#C0392B',
      info: '#4A6FB5',
      overlay: 'rgba(30,23,48,0.45)',
    },
    chart: ['#6D4BB5', '#1E1730', '#1B7F4B', '#B26A00', '#C0392B'],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    pro: true,
    dark: true,
    colors: {
      background: '#17100F',
      surface: '#211614',
      surfaceAlt: '#2C1E1B',
      border: '#3C2A26',
      text: '#FBEFEA',
      textMuted: '#C0A79F',
      textFaint: '#93786F',
      accent: '#FF8A5B',
      accentSoft: '#3A231C',
      accentText: '#17100F',
      positive: '#59C48C',
      attention: '#E6B054',
      danger: '#FF7061',
      info: '#7FB2E5',
      overlay: 'rgba(0,0,0,0.6)',
    },
    chart: ['#FF8A5B', '#E6B054', '#59C48C', '#7FB2E5', '#D9A2FF'],
  },
];

export function themeById(id: string, systemDark: boolean): Theme {
  const found = THEMES.find((theme) => theme.id === id);
  if (found) return found;
  return systemDark ? THEMES[2] : THEMES[0];
}

export const FREE_THEME_IDS = THEMES.filter((theme) => !theme.pro).map((theme) => theme.id);

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 } as const;

export const fontSizes = { caption: 12, small: 13, body: 15, title: 17, heading: 20, display: 28, hero: 36 } as const;

/** Tabular figures keep money columns aligned. */
export const tabularNums: TextStyle = Platform.select({
  android: { fontVariant: ['tabular-nums'], fontFeatureSettings: '"tnum"' },
  default: { fontVariant: ['tabular-nums'] },
}) as TextStyle;

export const MIN_TOUCH_SIZE = 44;
