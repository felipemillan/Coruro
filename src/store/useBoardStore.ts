// Zustand store for Coruro.
//
// Holds the persisted AppState (settings/board/repoMetadata) plus runtime-only
// fields: the scanned `repos` list and a `loaded` flag.
//
// Persistence rules (PRD + plan):
//  - State file: ~/.repo_dashboard_state.json via @tauri-apps/plugin-fs,
//    BaseDirectory.Home.
//  - LOAD BEFORE SAVE: never write to disk until load() has completed. This
//    prevents a startup race where an early save clobbers an existing file
//    with default state before it has been read.
//  - The raw GitHub token NEVER touches JSON. It lives in the macOS Keychain
//    via the Rust `store_token` / `get_token` commands. Only the boolean
//    `hasToken` flag is persisted.
//  - updateNotes() debounces disk writes by 500ms so typing doesn't thrash IO.
//
// This module is the composition root: it owns the initial runtime state and
// merges the behaviour slices (persistence / enrich / dayNotes / chatSessions /
// settings) into the single BoardStore identity. The slice creators and pure
// helpers live alongside it under src/store/.

import { create } from 'zustand';
import { createEmptyAppState } from '../types';
import type { BoardStore } from './boardStoreTypes';
import { createPersistenceSlice } from './persistenceSlice';
import { createEnrichSlice } from './enrichSlice';
import { createDayNotesSlice } from './dayNotesSlice';
import { createChatSessionsSlice } from './chatSessionsSlice';
import { createActivityLogSlice } from './activityLogSlice';
import { createSettingsSlice } from './settingsSlice';

export type { BoardStore } from './boardStoreTypes';

export const useBoardStore = create<BoardStore>((set, get) => ({
  ...createEmptyAppState(),
  repos: [],
  loaded: false,
  lastScanError: null,
  analyzingPaths: new Set(),
  aiUnavailableReason: null,
  generatingNotes: false,
  notesError: null,

  ...createPersistenceSlice(set, get),
  ...createEnrichSlice(set, get),
  ...createDayNotesSlice(set, get),
  ...createChatSessionsSlice(set, get),
  ...createActivityLogSlice(set, get),
  ...createSettingsSlice(set, get),
}));
