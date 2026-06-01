// Board.tsx — the five-column Kanban surface for MyGITdash.
//
// Columns: Inbox / Backlog / Active / Review / Done (order from COLUMN_IDS).
// Drag-and-drop is powered by @hello-pangea/dnd:
//   - one DragDropContext wraps the whole board,
//   - one Droppable per column,
//   - one Draggable per repo card.
//
// On drop we call store.moveCard(repoPath, sourceColumn, destColumn, destIndex).
// A null destination (dropped outside any column) is ignored.
//
// Card ORDER comes from the persisted `board` slice (arrays of repo paths per
// column); the live `Repo` object is looked up from the runtime `repos` list
// by path. A path with no matching scanned repo is skipped (stale entry from a
// previous scan), so the UI never renders a dead card.
//
// NOTE: @hello-pangea/dnd breaks under React.StrictMode's double-invoke;
// StrictMode is intentionally disabled in main.tsx (see comment there).
//
// Aesthetic: cream surface, deep-navy headers, hard corners (rounded-none),
// indie-pastel palette tokens from index.css.

import { useCallback, useMemo } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { COLUMN_IDS, type ColumnId, type Repo } from '../types';
import { useBoardStore } from '../store/useBoardStore';
import { useViewStore } from '../store/useViewStore';
import { applyView } from '../utils/filterSort';
import { isViewActive } from '../view';
import { RepoCard } from './RepoCard';
import { RepoDetail } from './RepoDetail';
import { Toolbar } from './Toolbar';

/** Human-readable column headers, keyed by ColumnId. */
const COLUMN_LABELS: Record<ColumnId, string> = {
  inbox: 'Inbox',
  backlog: 'Backlog',
  active: 'Active',
  review: 'Review',
  done: 'Done',
};

/** Type guard: narrow an arbitrary droppable id back to a ColumnId. */
function isColumnId(value: string): value is ColumnId {
  return (COLUMN_IDS as readonly string[]).includes(value);
}

export function Board() {
  const board = useBoardStore((s) => s.board);
  const repos = useBoardStore((s) => s.repos);
  const moveCard = useBoardStore((s) => s.moveCard);

  const search = useViewStore((s) => s.search);
  const filters = useViewStore((s) => s.filters);
  const sort = useViewStore((s) => s.sort);
  const selectedPath = useViewStore((s) => s.selectedPath);
  const detailPath = useViewStore((s) => s.detailPath);
  const setDetail = useViewStore((s) => s.setDetail);

  // Fast path lookup: repo path -> live Repo (from the latest scan).
  // Memoised on repos so the Map is not rebuilt on every render.
  const repoByPath = useMemo<Map<string, Repo>>(
    () => new Map(repos.map((r) => [r.path, r])),
    [repos],
  );

  // Drag is only safe in pure manual order with no active filter/search:
  // otherwise the rendered subset's indices no longer map onto the persisted
  // column array and a drop would corrupt the saved order.
  const dragEnabled = !isViewActive({ search, filters, sort });

  // The repo whose detail modal is open (if it still exists in the scan).
  const detailRepo = detailPath !== null ? repoByPath.get(detailPath) ?? null : null;

  const onDragEnd = useCallback((result: DropResult) => {
    const { source, destination, draggableId } = result;
    // Dropped outside any droppable — nothing to do.
    if (!destination) return;
    // Defensive: ignore unexpected droppable ids.
    if (
      !isColumnId(source.droppableId) ||
      !isColumnId(destination.droppableId)
    ) {
      return;
    }
    // No-op drop in the exact same spot.
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }
    moveCard(
      draggableId,
      source.droppableId,
      destination.droppableId,
      destination.index,
    );
  }, [moveCard]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Toolbar />

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-5 gap-4 p-4 flex-1 min-h-0">
          {COLUMN_IDS.map((columnId) => {
            // All live repos in this column (persisted order), then the view
            // transform (search + filters + sort). `manual` sort keeps order.
            const allRepos = board[columnId]
              .map((path) => repoByPath.get(path))
              .filter((r): r is Repo => r !== undefined);
            const visible = applyView(allRepos, { search, filters, sort });

            return (
              <section
                key={columnId}
                className="flex flex-col min-h-0 bg-cream/60 backdrop-blur-sm border border-navy/10 rounded-xl shadow-sm"
              >
                <header className="px-3 py-2 border-b border-navy/15 shrink-0">
                  <h2 className="text-navy font-semibold text-sm uppercase tracking-wide flex items-center justify-between">
                    <span>{COLUMN_LABELS[columnId]}</span>
                    <span className="text-navy-light font-normal tabular-nums rounded-full bg-navy/8 px-2 py-0.5 text-xs">
                      {visible.length === allRepos.length
                        ? allRepos.length
                        : `${visible.length}/${allRepos.length}`}
                    </span>
                  </h2>
                </header>

                <Droppable droppableId={columnId} isDropDisabled={!dragEnabled}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={[
                        'flex-1 min-h-0 overflow-y-auto p-2 space-y-2 transition-colors',
                        snapshot.isDraggingOver ? 'bg-sage-light/40' : '',
                      ].join(' ')}
                    >
                      {visible.map((repo, index) => (
                        <Draggable
                          key={repo.path}
                          draggableId={repo.path}
                          index={index}
                          isDragDisabled={!dragEnabled}
                        >
                          {(dragProvided) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                            >
                              <RepoCard repo={repo} selected={repo.path === selectedPath} />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </section>
            );
          })}
        </div>
      </DragDropContext>

      {/* Single detail modal, lifted out of RepoCard so the keyboard ⏎
          shortcut can open the selected repo. */}
      {detailRepo !== null && (
        <RepoDetail repo={detailRepo} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
