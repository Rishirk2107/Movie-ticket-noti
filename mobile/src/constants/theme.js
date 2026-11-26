import { Platform } from 'react-native';

export const COLORS = {
  bgBase: '#090D16',
  bgCard: '#111827',
  bgElevated: '#161F31',
  bgInput: '#060911',
  bgGlass: 'rgba(17, 24, 39, 0.92)',

  borderGlass: '#1E293B',
  borderSubtle: 'rgba(148, 163, 184, 0.14)',
  borderStrong: 'rgba(148, 163, 184, 0.28)',

  textMain: '#F8FAFC',
  textMuted: '#94A3B8',
  textDim: '#64748B',

  crimson: '#EF4444',
  crimsonDark: '#DC2626',
  crimsonSubtle: 'rgba(239, 68, 68, 0.14)',
  crimsonBorder: 'rgba(239, 68, 68, 0.42)',

  emerald: '#10B981',
  emeraldSubtle: 'rgba(16, 185, 129, 0.14)',
  emeraldBorder: 'rgba(16, 185, 129, 0.4)',

  amber: '#F59E0B',
  amberSubtle: 'rgba(245, 158, 11, 0.14)',
  amberBorder: 'rgba(245, 158, 11, 0.4)',

  cyan: '#38BDF8',
  cyanSubtle: 'rgba(56, 189, 248, 0.14)',
  cyanBorder: 'rgba(56, 189, 248, 0.35)',

  danger: '#F87171',
  dangerSubtle: 'rgba(248, 113, 113, 0.14)',
  dangerBorder: 'rgba(248, 113, 113, 0.4)',
};

export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  full: 999,
};

export const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export const SHADOWS = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  dock: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 20,
    elevation: 14,
  },
  crimsonGlow: {
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
};
