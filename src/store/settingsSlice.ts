// Settings slice: simple persisted-setting setters (refresh interval, debug
// banner, editor/terminal app commands). Each mutates one settings field and
// persists. Behaviour is identical to the inline implementation it replaces.

import type { BoardStore } from './boardStoreTypes';
import { type BoardSet, type BoardGet } from './boardStoreShared';

type SettingsSlice = Pick<
  BoardStore,
  | 'setRefreshInterval'
  | 'setDebugBannerEnabled'
  | 'setEditorCommand'
  | 'setEditorApp'
  | 'setTerminalApp'
  | 'setTerminalTheme'
>;

export function createSettingsSlice(set: BoardSet, get: BoardGet): SettingsSlice {
  return {
    setRefreshInterval: async (min) => {
      set((s) => ({ settings: { ...s.settings, refreshIntervalMin: min } }));
      await get().save();
    },

    setDebugBannerEnabled: async (enabled) => {
      set((s) => ({ settings: { ...s.settings, debugBannerEnabled: enabled } }));
      await get().save();
    },

    setEditorCommand: async (command) => {
      set((s) => ({ settings: { ...s.settings, editorCommand: command } }));
      await get().save();
    },

    setEditorApp: async (app) => {
      set((s) => ({ settings: { ...s.settings, editorApp: app } }));
      await get().save();
    },

    setTerminalApp: async (app) => {
      set((s) => ({ settings: { ...s.settings, terminalApp: app } }));
      await get().save();
    },

    setTerminalTheme: async (theme) => {
      set((s) => ({ settings: { ...s.settings, terminalTheme: theme } }));
      await get().save();
    },
  };
}
