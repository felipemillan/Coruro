// Catppuccin terminal themes for xterm.js.
// Full 16-color ANSI palette + UI colors for Mocha (dark) and Latte (light).
//
// Credit: catppuccin/catppuccin (MIT License)
// https://github.com/catppuccin/catppuccin

import type { ITheme } from '@xterm/xterm';

export const CATPPUCCIN_MOCHA: ITheme = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: '#585b7066',
  selectionForeground: '#cdd6f4',
  selectionInactiveBackground: '#45475a66',
  // ANSI colors
  black: '#45475a',
  brightBlack: '#585b70',
  red: '#f38ba8',
  brightRed: '#eba0ac',
  green: '#a6e3a1',
  brightGreen: '#94e2d5',
  yellow: '#f9e2af',
  brightYellow: '#fab387',
  blue: '#89b4fa',
  brightBlue: '#74c7ec',
  magenta: '#f5c2e7',
  brightMagenta: '#cba6f7',
  cyan: '#94e2d5',
  brightCyan: '#89dceb',
  white: '#bac2de',
  brightWhite: '#cdd6f4',
};

export const CATPPUCCIN_LATTE: ITheme = {
  background: '#eff1f5',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  cursorAccent: '#eff1f5',
  selectionBackground: '#acb0be66',
  selectionForeground: '#4c4f69',
  selectionInactiveBackground: '#9ca0b066',
  // ANSI colors
  black: '#e6e9ef',
  brightBlack: '#acb0be',
  red: '#d20f39',
  brightRed: '#e64553',
  green: '#40a02b',
  brightGreen: '#179299',
  yellow: '#df8e1d',
  brightYellow: '#fe640b',
  blue: '#1e66f5',
  brightBlue: '#209fb5',
  magenta: '#ea76cb',
  brightMagenta: '#8839ef',
  cyan: '#179299',
  brightCyan: '#04a5e5',
  white: '#6c6f85',
  brightWhite: '#4c4f69',
};
