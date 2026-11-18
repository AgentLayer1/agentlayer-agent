import { ANSI, paint, rgbEscape } from '@/shared/ansi';
import { type AgentColors, DEFAULT_AGENT_COLORS } from '@/shared/persona';

interface Palette extends AgentColors {
  primaryName: string;
  accentName: string;
  squares: string;
}

/** The colors init offers, Oppi's first. Each reads at 2.5:1 or better on a white and on a near-black terminal. */
export const PALETTES: readonly Palette[] = [
  { ...DEFAULT_AGENT_COLORS, primaryName: 'orchid', accentName: 'mint', squares: '🟪🟩' },
  { primaryName: 'ocean', primary: '#2F7FC1', accentName: 'coral', accent: '#E0664A', squares: '🟦🟧' },
  { primaryName: 'crimson', primary: '#C7354B', accentName: 'gold', accent: '#C99A2E', squares: '🟥🟨' },
  { primaryName: 'amber', primary: '#C98A1E', accentName: 'teal', accent: '#2A9D8F', squares: '🟧🟦' }
];

const HEX = /^#[0-9A-Fa-f]{6}$/;

const findPalette = ({ primary, accent }: AgentColors): Palette | undefined =>
  PALETTES.find((palette) => palette.primary === primary && palette.accent === accent);

const capitalized = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const swatch = ({ primary, accent }: AgentColors): string =>
  `${paint('██', rgbEscape(primary))}${paint('██', rgbEscape(accent))}`;

const pair = (first: string, primary: string, second: string, accent: string): string =>
  `${paint(first, ANSI.bold, rgbEscape(primary))} & ${paint(second, ANSI.bold, rgbEscape(accent))}`;

/** The `**Colors:**` value IDENTITY.md carries for a pair. */
export const colorsLine = (colors: AgentColors): string => {
  const named = findPalette(colors);
  return `${named?.primaryName ?? 'primary'} \`${colors.primary}\` (primary) · ${named?.accentName ?? 'accent'} \`${colors.accent}\` (accent)`;
};

/**
 * The pairs init offers, each drawn in its own colors; a custom current pair is listed first.
 */
export const colorChoices = (current: AgentColors): string[] => {
  const rows = PALETTES.map(
    (palette, index) =>
      `  ${swatch(palette)} ${index + 1}  ${pair(capitalized(palette.primaryName), palette.primary, palette.accentName, palette.accent)}${index === 0 ? "  Oppi's" : ''}`
  );
  return findPalette(current)
    ? rows
    : [`  ${swatch(current)} now  ${pair(current.primary, current.primary, current.accent, current.accent)}`, ...rows];
};

/**
 * The `**Colors:**` value for a choice: a pair's number, or two `#RRGGBB` codes (primary, then accent). Undefined when
 * the choice is neither.
 */
export const colorsLineFor = (choice: string): string | undefined => {
  const palette = /^\d$/.test(choice) ? PALETTES[Number(choice) - 1] : undefined;
  if (palette) {
    return colorsLine(palette);
  }
  const [primary = '', accent = '', ...rest] = choice.trim().split(/\s+/);
  return HEX.test(primary) && HEX.test(accent) && !rest.length
    ? colorsLine({ primary: primary.toUpperCase(), accent: accent.toUpperCase() })
    : undefined;
};
