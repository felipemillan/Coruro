// Settings slice: simple persisted-setting setters (refresh interval, debug
// banner, editor/terminal app commands). Each mutates one settings field and
// persists. Behaviour is identical to the inline implementation it replaces.

import type { BoardStore } from './boardStoreTypes';
import { type BoardSet, type BoardGet } from './boardStoreShared';
import { type PublisherRole, type PublisherSeniority, MAX_PUBLISHER_AUDIENCE_LEN } from '../types';

type SettingsSlice = Pick<
  BoardStore,
  | 'setRefreshInterval'
  | 'setDebugBannerEnabled'
  | 'setEditorCommand'
  | 'setEditorApp'
  | 'setTerminalApp'
  | 'setTerminalTheme'
  | 'setTerminalDefaultModel'
  | 'setBellAudioEnabled'
  | 'setBellVisualEnabled'
  | 'setPublisherAuthorVoice'
  | 'setPublisherDefaultTarget'
  | 'setPublisherDefaultFormat'
  | 'setPublisherDefaultIntent'
  | 'setPublisherDefaultModel'
  | 'setPublisherDefaultRoles'
  | 'setPublisherDefaultSeniority'
  | 'setPublisherDefaultAudience'
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

    setTerminalDefaultModel: async (m) => {
      set((s) => ({ settings: { ...s.settings, terminalDefaultModel: m } }));
      await get().save();
    },

    setBellAudioEnabled: async (enabled) => {
      set((s) => ({ settings: { ...s.settings, bellAudioEnabled: enabled } }));
      await get().save();
    },

    setBellVisualEnabled: async (enabled) => {
      set((s) => ({ settings: { ...s.settings, bellVisualEnabled: enabled } }));
      await get().save();
    },

    setPublisherAuthorVoice: async (voice) => {
      set((s) => ({ settings: { ...s.settings, publisherAuthorVoice: voice } }));
      await get().save();
    },

    setPublisherDefaultTarget: async (t) => {
      set((s) => ({ settings: { ...s.settings, publisherDefaultTarget: t } }));
      await get().save();
    },

    setPublisherDefaultFormat: async (f) => {
      set((s) => ({ settings: { ...s.settings, publisherDefaultFormat: f } }));
      await get().save();
    },

    setPublisherDefaultIntent: async (i) => {
      set((s) => ({ settings: { ...s.settings, publisherDefaultIntent: i } }));
      await get().save();
    },

    setPublisherDefaultModel: async (m) => {
      set((s) => ({ settings: { ...s.settings, publisherDefaultModel: m } }));
      await get().save();
    },

    setPublisherDefaultRoles: async (r: PublisherRole[]) => {
      set((s) => ({ settings: { ...s.settings, publisherDefaultRoles: r } }));
      await get().save();
    },

    setPublisherDefaultSeniority: async (seniority: PublisherSeniority) => {
      set((s) => ({ settings: { ...s.settings, publisherDefaultSeniority: seniority } }));
      await get().save();
    },

    setPublisherDefaultAudience: async (a: string) => {
      const capped = a.slice(0, MAX_PUBLISHER_AUDIENCE_LEN);
      set((s) => ({ settings: { ...s.settings, publisherDefaultAudience: capped } }));
      await get().save();
    },
  };
}
