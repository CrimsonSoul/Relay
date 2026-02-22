type ColorScheme = {
  bg: string;
  border: string;
  text: string;
  fill: string;
};

const makeColorScheme = (rgb: string, text: string, fill: string): ColorScheme => ({
  bg: `rgba(${rgb}, 0.2)`,
  border: `rgba(${rgb}, 0.4)`,
  text,
  fill,
});

const PALETTE: ColorScheme[] = [
  makeColorScheme('239, 68, 68', '#FCA5A5', '#EF4444'),
  makeColorScheme('249, 115, 22', '#FDBA74', '#F97316'),
  makeColorScheme('245, 158, 11', '#FCD34D', '#F59E0B'),
  makeColorScheme('16, 185, 129', '#6EE7B7', '#10B981'),
  makeColorScheme('6, 182, 212', '#67E8F9', '#06B6D4'),
  makeColorScheme('99, 102, 241', '#A5B4FC', '#6366F1'),
  makeColorScheme('139, 92, 246', '#C4B5FD', '#8B5CF6'),
  makeColorScheme('236, 72, 153', '#F9A8D4', '#EC4899'),
  makeColorScheme('6, 182, 212', '#67E8F9', '#06B6D4'),
  makeColorScheme('132, 204, 22', '#BEF264', '#84CC16'),
  makeColorScheme('244, 63, 94', '#FDA4AF', '#F43F5E'),
  makeColorScheme('20, 184, 166', '#5EEAD4', '#14B8A6'),
  makeColorScheme('251, 191, 36', '#FDE68A', '#FBBF24'),
  makeColorScheme('168, 85, 247', '#D8B4FE', '#A855F7'),
];

export const AMBER: ColorScheme = {
  bg: 'rgba(245, 158, 11, 0.15)',
  border: 'rgba(245, 158, 11, 0.3)',
  text: '#FCD34D',
  fill: '#F59E0B',
};

export const getColorForString = (str: string): ColorScheme => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (str.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
};
