"use client";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { confirmDialog } from "./ConfirmDialog";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type CategoryNode = {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  children: CategoryNode[];
};

type ScriptSummary = {
  id: string;
  name: string;
};

type Props = {
  onClose: () => void;
};

const SCRIPT_PREFIX = "script:";
const UNCATEGORIZED_ID = "__uncategorized__";

function DraggableScript({ script }: { script: ScriptSummary }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: SCRIPT_PREFIX + script.id,
    data: { type: "script", scriptId: script.id },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-2 py-1 px-2 text-[11px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800 rounded cursor-grab active:cursor-grabbing select-none"
    >
      <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" className="text-gray-300 shrink-0">
        <circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" />
        <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
        <circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" />
      </svg>
      <span className="truncate">{script.name}</span>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  scripts,
  scriptCategoryMap,
  onAdd,
  onRename,
  onDelete,
}: {
  node: CategoryNode;
  depth: number;
  scripts: ScriptSummary[];
  scriptCategoryMap: Map<string, string>;
  onAdd: (parentId: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);

  const {
    attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging,
  } = useSortable({ id: node.id, data: { type: "category" } });

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: node.id,
    data: { type: "category-drop", categoryId: node.id },
  });

  const setRef = (el: HTMLElement | null) => {
    setSortableRef(el);
    setDroppableRef(el);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleRename = () => {
    if (editName.trim() && editName.trim() !== node.name) {
      onRename(node.id, editName.trim());
    }
    setEditing(false);
  };

  const scriptsInCategory = scripts.filter((s) => scriptCategoryMap.get(s.id) === node.id);

  return (
    <div ref={setRef} style={style}>
      <div
        className={`flex items-center gap-1.5 group py-1 rounded ${isOver ? "bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-400" : ""}`}
        style={{ paddingLeft: depth * 20 }}
      >
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="w-4 h-4 flex items-center justify-center text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0"
          title="Drag to reorder"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/>
            <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
            <circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/>
          </svg>
        </button>

        {depth > 0 && (
          <span className="text-gray-300 dark:text-neutral-600 text-xs select-none shrink-0">&#x251C;</span>
        )}
        {node.children.length > 0 ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-4 h-4 flex items-center justify-center text-[10px] text-gray-400 hover:text-gray-600 shrink-0"
          >
            {expanded ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 15 12 9 18 15" /></svg>
            )}
          </button>
        ) : (
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-neutral-600" />
          </span>
        )}

        {editing ? (
          <input
            className="text-xs border border-blue-400 rounded px-1.5 py-0.5 bg-transparent focus:outline-none w-32"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") { setEditName(node.name); setEditing(false); }
            }}
            autoFocus
          />
        ) : (
          <span
            className="text-xs font-medium cursor-pointer hover:text-blue-500"
            onDoubleClick={() => { setEditName(node.name); setEditing(true); }}
          >
            {node.name}
          </span>
        )}

        <span className="text-[10px] text-gray-400">
          ({scriptsInCategory.length})
        </span>

        <div className="flex gap-0.5 ml-auto">
          {depth < 4 && (
            <button
              onClick={() => onAdd(node.id)}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              title="Add subcategory"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          )}
          <button
            onClick={() => onDelete(node.id)}
            className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            title="Delete"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>

      {/* Scripts inside this category */}
      {expanded && (
        <div style={{ paddingLeft: depth * 20 + 28 }} className="mb-1">
          {scriptsInCategory.length === 0 ? (
            <div className="text-[10px] text-gray-300 dark:text-neutral-600 italic py-1 px-2">
              Drop scripts here
            </div>
          ) : (
            scriptsInCategory.map((s) => (
              <DraggableScript key={s.id} script={s} />
            ))
          )}
        </div>
      )}

      {/* Children */}
      {expanded && node.children.length > 0 && (
        <SortableContext items={node.children.map(c => c.id)} strategy={verticalListSortingStrategy}>
          <div className="relative">
            <div
              className="absolute top-0 bottom-0 border-l border-gray-200 dark:border-neutral-700"
              style={{ left: depth * 20 + 8 }}
            />
            {node.children.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                scripts={scripts}
                scriptCategoryMap={scriptCategoryMap}
                onAdd={onAdd}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </div>
        </SortableContext>
      )}
    </div>
  );
}

function UncategorizedSection({
  uncategorizedScripts,
}: {
  uncategorizedScripts: ScriptSummary[];
}) {
  const [expanded, setExpanded] = useState(true);
  const { setNodeRef, isOver } = useDroppable({
    id: UNCATEGORIZED_ID,
    data: { type: "category-drop", categoryId: null },
  });

  return (
    <div
      ref={setNodeRef}
      className={`mb-2 rounded ${isOver ? "bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-400" : ""}`}
    >
      <div className="flex items-center gap-1.5 py-1 px-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
        >
          {expanded ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 15 12 9 18 15" /></svg>
          )}
        </button>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Uncategorized
        </span>
        <span className="text-[10px] text-gray-400">({uncategorizedScripts.length})</span>
      </div>
      {expanded && (
        <div className="pl-6 pb-1">
          {uncategorizedScripts.length === 0 ? (
            <div className="text-[10px] text-gray-300 dark:text-neutral-600 italic py-1 px-2">
              Drop scripts here to remove them from a category
            </div>
          ) : (
            uncategorizedScripts.map((s) => (
              <DraggableScript key={s.id} script={s} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function CategoryManagerModal({ onClose }: Props) {
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [scriptCategoryMap, setScriptCategoryMap] = useState<Map<string, string>>(new Map());
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeDragName, setActiveDragName] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const loadData = useCallback(async () => {
    try {
      const [catRes, scriptRes] = await Promise.all([
        fetch("/api/categories"),
        fetch("/api/scripts"),
      ]);
      if (catRes.ok) setTree(await catRes.json());
      if (scriptRes.ok) {
        const data = await scriptRes.json();
        setScripts(data.map((s: any) => ({ id: s.id, name: s.name })));
        const map = new Map<string, string>();
        for (const s of data) {
          if (s.category) {
            map.set(s.id, s.category.id);
          }
        }
        setScriptCategoryMap(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const addCategory = async (parentId: string | null) => {
    const name = parentId ? "New subcategory" : newName.trim();
    if (!name) return;
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent_id: parentId }),
    });
    if (res.ok) {
      setNewName("");
      loadData();
    }
  };

  const renameCategory = async (id: string, name: string) => {
    await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    loadData();
  };

  const deleteCategory = async (id: string) => {
    if (!(await confirmDialog({ title: "Delete this category?", message: "All subcategories under it are removed as well." }))) return;
    await fetch(`/api/categories/${id}`, { method: "DELETE" });
    loadData();
  };

  const findSiblingsAndParent = (nodes: CategoryNode[], targetId: string, parentId: string | null): { siblings: CategoryNode[]; parentId: string | null } | null => {
    for (const n of nodes) {
      if (n.id === targetId) return { siblings: nodes, parentId };
    }
    for (const n of nodes) {
      const found = findSiblingsAndParent(n.children, targetId, n.id);
      if (found) return found;
    }
    return null;
  };

  const reassignScript = async (scriptId: string, categoryId: string | null) => {
    // Optimistic update
    setScriptCategoryMap((prev) => {
      const next = new Map(prev);
      if (categoryId === null) next.delete(scriptId);
      else next.set(scriptId, categoryId);
      return next;
    });
    try {
      await fetch(`/api/scripts/${scriptId}/category`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: categoryId }),
      });
      window.dispatchEvent(new Event("scripts-changed"));
    } catch {
      loadData();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    if (id.startsWith(SCRIPT_PREFIX)) {
      const scriptId = id.slice(SCRIPT_PREFIX.length);
      const s = scripts.find((x) => x.id === scriptId);
      setActiveDragName(s?.name ?? null);
    } else {
      setActiveDragName(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragName(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Script drop
    if (activeId.startsWith(SCRIPT_PREFIX)) {
      const scriptId = activeId.slice(SCRIPT_PREFIX.length);
      let targetCategoryId: string | null;
      if (overId === UNCATEGORIZED_ID) {
        targetCategoryId = null;
      } else if (overId.startsWith(SCRIPT_PREFIX)) {
        // dropped onto another script — use that script's current category
        const otherScriptId = overId.slice(SCRIPT_PREFIX.length);
        targetCategoryId = scriptCategoryMap.get(otherScriptId) ?? null;
      } else {
        targetCategoryId = overId;
      }
      const current = scriptCategoryMap.get(scriptId) ?? null;
      if (current === targetCategoryId) return;
      await reassignScript(scriptId, targetCategoryId);
      return;
    }

    // Category reordering (existing behavior)
    if (activeId === overId) return;
    const result = findSiblingsAndParent(tree, activeId, null);
    if (!result) return;
    const { siblings } = result;

    const idxA = siblings.findIndex((s) => s.id === activeId);
    const idxB = siblings.findIndex((s) => s.id === overId);
    if (idxA === -1 || idxB === -1) return;

    const reordered = [...siblings];
    [reordered[idxA], reordered[idxB]] = [reordered[idxB], reordered[idxA]];

    await fetch("/api/categories/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_ids: reordered.map((s) => s.id) }),
    });
    loadData();
  };

  const uncategorizedScripts = scripts.filter((s) => !scriptCategoryMap.has(s.id));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.12 }}
        className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-700 shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Categories</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="text-xs text-gray-400">Loading...</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <UncategorizedSection uncategorizedScripts={uncategorizedScripts} />

              <SortableContext items={tree.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                {tree.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    scripts={scripts}
                    scriptCategoryMap={scriptCategoryMap}
                    onAdd={addCategory}
                    onRename={renameCategory}
                    onDelete={deleteCategory}
                  />
                ))}
              </SortableContext>
              {tree.length === 0 && (
                <p className="text-xs text-gray-400 py-2">No categories yet.</p>
              )}

              <DragOverlay>
                {activeDragName && (
                  <div className="flex items-center gap-2 py-1 px-2 text-[11px] text-gray-700 dark:text-gray-200 bg-white dark:bg-neutral-800 border border-blue-400 rounded shadow-lg">
                    <span className="truncate">{activeDragName}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-neutral-800 px-5 py-3">
          <div className="flex gap-2">
            <input
              className="flex-1 text-xs border border-gray-300 dark:border-neutral-700 rounded px-3 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New top-level category"
              onKeyDown={(e) => { if (e.key === "Enter") addCategory(null); }}
            />
            <button
              onClick={() => addCategory(null)}
              disabled={!newName.trim()}
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded font-medium disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
