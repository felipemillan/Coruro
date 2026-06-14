// TreeRow.tsx — recursive file-tree row for the RepoDetail left pane.
// Directories toggle open/closed; files fire onSelect.

import { FileText, Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import type { TreeNode } from '../../utils/repoDetail';

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (node: TreeNode) => void;
}

export function TreeRow({ node, depth, expanded, toggle, selectedPath, onSelect }: TreeRowProps) {
  const isOpen = expanded.has(node.path);
  const pad = { paddingLeft: `${depth * 14 + 8}px` };

  if (!node.isDir) {
    const active = selectedPath === node.path;
    return (
      <button
        type="button"
        onClick={() => onSelect(node)}
        className={`flex items-center gap-1.5 w-full py-0.5 text-[12px] font-mono truncate text-left transition-colors cursor-pointer rounded-lg ${
          active ? 'bg-sage/20 text-navy' : 'text-navy-light hover:bg-warm-gray'
        }`}
        style={pad}
        title={node.path}
      >
        <FileText size={12} strokeWidth={1.5} className="shrink-0 text-navy-light/50" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(node.path)}
        className="flex items-center gap-1 w-full py-0.5 text-[12px] text-navy font-mono hover:bg-warm-gray transition-colors cursor-pointer truncate rounded-lg"
        style={pad}
        title={node.path}
      >
        {isOpen ? (
          <ChevronDown size={12} strokeWidth={1.5} className="shrink-0" />
        ) : (
          <ChevronRight size={12} strokeWidth={1.5} className="shrink-0" />
        )}
        {isOpen ? (
          <FolderOpen size={12} strokeWidth={1.5} className="shrink-0 text-sage" />
        ) : (
          <Folder size={12} strokeWidth={1.5} className="shrink-0 text-sage" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isOpen &&
        node.children?.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}
