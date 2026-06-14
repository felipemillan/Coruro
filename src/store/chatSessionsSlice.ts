// Chat-sessions slice: append/update/delete ASK chat session metadata. Only
// metadata is persisted (never PTY buffers). Behaviour is identical to the
// inline implementation it replaces.

import type { BoardStore } from './boardStoreTypes';
import { type BoardSet, type BoardGet } from './boardStoreShared';

type ChatSessionsSlice = Pick<
  BoardStore,
  'addChatSession' | 'updateChatSessionStatus' | 'deleteChatSession'
>;

export function createChatSessionsSlice(set: BoardSet, get: BoardGet): ChatSessionsSlice {
  return {
    addChatSession: (session) => {
      set((s) => ({
        chatSessions: { ...s.chatSessions, sessions: [...s.chatSessions.sessions, session] },
      }));
      void get().save();
    },

    updateChatSessionStatus: (id, status, exitCode) => {
      set((s) => ({
        chatSessions: {
          ...s.chatSessions,
          sessions: s.chatSessions.sessions.map((sess) =>
            sess.id === id ? { ...sess, status, exitCode } : sess,
          ),
        },
      }));
      void get().save();
    },

    deleteChatSession: (id) => {
      set((s) => ({
        chatSessions: {
          ...s.chatSessions,
          sessions: s.chatSessions.sessions.filter((sess) => sess.id !== id),
        },
      }));
      void get().save();
    },
  };
}
