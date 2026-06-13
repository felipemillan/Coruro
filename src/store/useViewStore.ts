// Zustand store for Board view state.
//
// Runtime-only ephemeral lens over repos: search, filters, sort, selection.
// Never persisted — the persisted `board` column order remains the source of
// truth. View transforms only affect what is rendered, not what is saved.

import { create } from 'zustand';
import { type ViewState, type FilterKey, type SortMode } from '../view';

interface ViewStore extends ViewState {
  /** Path of the repo whose detail modal is open, or null. Runtime-only. */
  detailPath: string | null;
  /** Path to pre-select in Ask tab when navigating from a repo card. */
  pendingAskPath: string | null;
  setSearch: (q: string) => void;
  toggleFilter: (k: FilterKey) => void;
  clearFilters: () => void;
  setSort: (m: SortMode) => void;
  setSelected: (path: string | null) => void;
  /** Open/close the detail modal (single modal lifted out of RepoCard). */
  setDetail: (path: string | null) => void;
  /** Navigate to Ask tab with this repo pre-selected. */
  requestAsk: (path: string) => void;
  clearPendingAsk: () => void;
  resetView: () => void;
}

export const useViewStore = create<ViewStore>((set) => ({
  search: '',
  filters: new Set(),
  sort: 'manual',
  selectedPath: null,
  detailPath: null,
  pendingAskPath: null,

  setSearch: (q: string) => {
    set({ search: q });
  },

  toggleFilter: (k: FilterKey) => {
    set((s) => {
      const next = new Set(s.filters);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return { filters: next };
    });
  },

  clearFilters: () => {
    set({ filters: new Set() });
  },

  setSort: (m: SortMode) => {
    set({ sort: m });
  },

  setSelected: (path: string | null) => {
    set({ selectedPath: path });
  },

  setDetail: (path: string | null) => {
    set({ detailPath: path });
  },

  requestAsk: (path: string) => {
    set({ pendingAskPath: path });
  },

  clearPendingAsk: () => {
    set({ pendingAskPath: null });
  },

  resetView: () => {
    set({ search: '', filters: new Set(), sort: 'manual' });
  },
}));
