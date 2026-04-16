"use client";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
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

function TreeNode({
  node,
  depth,
  scripts,
  scriptCategoryMap,
  onAdd,
  onRename,
  onDelete,
  onToggleScript,
}: {
  node: CategoryNode;
  depth: number;
  scripts: ScriptSummary[];
  scriptCategoryMap: Map<string, string>;
  onAdd: (parentId: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggleScript: (scriptId: string, categoryId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [showScripts, setShowScripts] = useState(true);

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: node.id });

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

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-1.5 group py-1" style={{ paddingLeft: depth * 20 }}>
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
          ({scripts.filter(s => scriptCategoryMap.get(s.id) === node.id).length})
        </span>

        <div className="flex gap-0.5 ml-auto">
          <button
            onClick={() => setShowScripts(!showScripts)}
            className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
            title="Assign scripts"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {showScripts
                ? <polyline points="6 9 12 15 18 9" />
                : <polyline points="6 15 12 9 18 15" />}
            </svg>
          </button>
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

      {/* Script assignment */}
      <AnimatePresence>
        {showScripts && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="overflow-hidden"
          >
            <div style={{ paddingLeft: depth * 20 + 24 }} className="mb-1">
              {scripts.map((s) => {
                const currentCat = scriptCategoryMap.get(s.id);
                const isAssignedHere = currentCat === node.id;
                const isAssignedElsewhere = currentCat && currentCat !== node.id;
                return (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 py-0.5 text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isAssignedHere}
                      onChange={() => onToggleScript(s.id, isAssignedHere ? null : node.id)}
                      className="rounded border-gray-300 dark:border-neutral-600"
                    />
                    <span className={isAssignedElsewhere ? "text-gray-300 dark:text-neutral-600" : ""}>
                      {s.name}
                    </span>
                    {isAssignedElsewhere && (
                      <span className="text-[10px] text-gray-300 dark:text-neutral-600 italic">
                        (in other category)
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Children */}
      {expanded && node.children.length > 0 && (
        <SortableContext items={node.children.map(c => c.id)} strategy={verticalListSortingStrategy}>
          <div className="relative" style={{ marginLeft: depth > 0 ? 0 : 0 }}>
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
                onToggleScript={onToggleScript}
              />
            ))}
          </div>
        </SortableContext>
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const loadData = useCallback(async () => {
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
    setLoading(false);
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
    if (!confirm("Delete this category and all its subcategories?")) return;
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

  const handleCategoryDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const result = findSiblingsAndParent(tree, active.id as string, null);
    if (!result) return;
    const { siblings } = result;

    const idxA = siblings.findIndex(s => s.id === active.id);
    const idxB = siblings.findIndex(s => s.id === over.id);
    if (idxA === -1 || idxB === -1) return;

    const reordered = [...siblings];
    [reordered[idxA], reordered[idxB]] = [reordered[idxB], reordered[idxA]];

    await fetch("/api/categories/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_ids: reordered.map(s => s.id) }),
    });
    loadData();
  };

  const toggleScript = async (scriptId: string, categoryId: string | null) => {
    await fetch(`/api/scripts/${scriptId}/category`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: categoryId }),
    });
    loadData();
    window.dispatchEvent(new Event("scripts-changed"));
  };

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
              onDragEnd={handleCategoryDragEnd}
            >
              <SortableContext items={tree.map(n => n.id)} strategy={verticalListSortingStrategy}>
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
                    onToggleScript={toggleScript}
                  />
                ))}
              </SortableContext>
              {tree.length === 0 && (
                <p className="text-xs text-gray-400 py-2">No categories yet.</p>
              )}
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
