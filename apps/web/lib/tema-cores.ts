// Papéis de cor do painel, nos modos claro e escuro (research.md R2).
// Fonte única: o globals.css repete estes valores como variáveis CSS, e o contraste.test.ts
// garante ≥ 4,5:1 nos pares de texto. Se mudar um valor aqui, mude também no globals.css.
//
// Os tons #1F7A6C (verde-azulado escuro) e #C2331F (laranja escuro) não estão no manual:
// são variações das cores oficiais, usadas só onde há texto (ver research.md R2).

export interface CoresDoTema {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentStrong: string;
  onAccentStrong: string;
  brand2: string;
  link: string;
  good: string;
  bad: string;
  warn: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  chart6: string;
}

export const TEMA_CLARO: CoresDoTema = {
  bg: '#F5F7F2',
  surface: '#FFFFFF',
  border: '#DADDD3',
  text: '#363630',
  muted: '#5C5C54',
  accent: '#B8D341',
  accentSoft: '#EEF6CC',
  accentStrong: '#363630',
  onAccentStrong: '#FFFFFF',
  brand2: '#31A391',
  link: '#1F7A6C',
  good: '#1F7A6C',
  bad: '#C2331F',
  warn: '#C2331F',
  chart1: '#31A391',
  chart2: '#B8D341',
  chart3: '#004A6D',
  chart4: '#363630',
  chart5: '#FD3168',
  chart6: '#E03F2A',
};

export const TEMA_ESCURO: CoresDoTema = {
  bg: '#1C1C19',
  surface: '#26261F',
  border: '#3A3A33',
  text: '#EDEDE6',
  muted: '#A8A89E',
  accent: '#B8D341',
  accentSoft: '#2F3A1C',
  accentStrong: '#B8D341',
  onAccentStrong: '#1C1C19',
  brand2: '#4CC2AE',
  link: '#4CC2AE',
  good: '#5FD0BC',
  bad: '#FF7A66',
  warn: '#FF7A66',
  chart1: '#4CC2AE',
  chart2: '#B8D341',
  chart3: '#3D8DB3',
  chart4: '#A8A89E',
  chart5: '#FD3168',
  chart6: '#FF7A66',
};
