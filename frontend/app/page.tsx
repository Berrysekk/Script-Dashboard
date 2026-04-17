"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import type { SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, AnimatePresence } from "motion/react";
import ScriptCard, { Script } from "./components/ScriptCard";
import UploadModal from "./components/UploadModal";
import LogDrawer   from "./components/LogDrawer";
import CategoryManagerModal from "./components/CategoryManagerModal";

type FilterView = "all" | "running" | "looping" | "idle";

// Only the item at overIndex gets a transform (to active's rect). All others stay put.
const swapStrategy: SortingStrategy = ({ rects, activeIndex, index, overIndex }) => {
  if (index === activeIndex) return null;
  if (index === overIndex && activeIndex !== -1) {
    const active = rects[activeIndex];
    const over = rects[overIndex];
    if (!active || !over) return null;
    return {
      x: active.left - over.left,
      y: active.top - over.top,
      scaleX: 1,
      scaleY: 1,
    };
  }
  return null;
};

// When dragging an uncategorized script, don't animate any sibling cards —
// the drop target is a whole category section, not another card.
const noopStrategy: SortingStrategy = () => null;

function SwappableScriptCard({
  script, onRun, onLoop, onStop, onLogs, index,
}: {
  script: Script;
  onRun:  (id: string) => Promise<void>;
  onLoop: (id: string, interval: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onLogs: () => void;
  index: number;
}) {
  const wasDragging = useRef(false);
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: script.id });

  useEffect(() => {
    if (isDragging) wasDragging.current = true;
  }, [isDragging]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (wasDragging.current) {
      e.preventDefault();
      e.stopPropagation();
      wasDragging.current = false;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClickCapture={handleClickCapture}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.15, delay: index * 0.03, ease: "easeOut" }}
      >
        <ScriptCard
          {...attributes}
          script={script}
          onRun={onRun}
          onLoop={onLoop}
          onStop={onStop}
          onLogs={onLogs}
          dragHandleProps={listeners}
        />
      </motion.div>
    </div>
  );
}

function StaticScriptCard({
  script, onRun, onLoop, onStop, onLogs, index,
}: {
  script: Script;
  onRun:  (id: string) => Promise<void>;
  onLoop: (id: string, interval: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onLogs: () => void;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.15, delay: index * 0.03, ease: "easeOut" }}
    >
      <ScriptCard
        script={script}
        onRun={onRun}
        onLoop={onLoop}
        onStop={onStop}
        onLogs={onLogs}
      />
    </motion.div>
  );
}

function CategorySection({
  group,
  onRun,
  onLoop,
  onStop,
  onLogs,
  isDraggable,
  highlighted = false,
}: {
  group: { id: string | null; name: string; scripts: Script[] };
  onRun: (id: string) => Promise<void>;
  onLoop: (id: string, interval: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onLogs: (s: Script) => void;
  isDraggable: boolean;
  highlighted?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { setNodeRef } = useDroppable({
    id: `cat:${group.id ?? "uncategorized"}`,
    disabled: !isDraggable,
  });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg p-2 -m-2 transition-colors duration-100 ${
        highlighted
          ? "bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400 dark:ring-blue-600"
          : "ring-2 ring-transparent"
      }`}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 mb-2 group"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-gray-400 transition-transform duration-100 ${collapsed ? "-rotate-90" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {group.name}
        </span>
        <span className="text-[10px] text-gray-400">({group.scripts.length})</span>
      </button>
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, overflow: "visible" }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
            transition={{ duration: 0.12 }}
          >
            <div className="grid grid-cols-3 gap-3">
                {group.scripts.map((s, i) =>
                  isDraggable ? (
                    <SwappableScriptCard
                      key={s.id}
                      script={s}
                      onRun={onRun}
                      onLoop={onLoop}
                      onStop={onStop}
                      onLogs={() => onLogs(s)}
                      index={i}
                    />
                  ) : (
                    <StaticScriptCard
                      key={s.id}
                      script={s}
                      onRun={onRun}
                      onLoop={onLoop}
                      onStop={onStop}
                      onLogs={() => onLogs(s)}
                      index={i}
                    />
                  )
                )}
              </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Dashboard() {
  const [scripts, setScripts]       = useState<Script[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [logsFor, setLogsFor]       = useState<Script | null>(null);
  const [filter, setFilter]         = useState<FilterView>("all");
  const [showCategories, setShowCategories] = useState(false);
  const [activeId, setActiveId]     = useState<string | null>(null);
  const [overCatKey, setOverCatKey] = useState<string | null>(null);
  const hasLoaded = useRef(false);
  const draggingRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const refresh = useCallback(async () => {
    if (draggingRef.current) return;
    const res = await fetch("/api/scripts");
    if (res.ok) {
      const data: Script[] = await res.json();
      setScripts(data);
      hasLoaded.current = true;
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleRun  = async (id: string) => {
    await fetch(`/api/scripts/${id}/run`, { method: "POST" });
    await refresh();
  };
  const handleStop = async (id: string) => {
    await fetch(`/api/scripts/${id}/stop`, { method: "POST" });
    await refresh();
  };
  const handleLoop = async (id: string, interval: string) => {
    await fetch(`/api/scripts/${id}/loop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval }),
    });
    await refresh();
  };

  const filteredScripts = scripts.filter(s => {
    if (filter === "running") return s.status === "running";
    if (filter === "looping") return s.loop_enabled;
    if (filter === "idle")    return s.status !== "running" && !s.loop_enabled;
    return true;
  });

  const activeScript = activeId ? scripts.find(s => s.id === activeId) ?? null : null;
  const activeIsUncategorized = activeScript ? !activeScript.category : false;

  const resolveCatKey = (overId: string): string | null => {
    if (overId.startsWith("cat:")) return overId.slice(4);
    const s = scripts.find(x => x.id === overId);
    return s?.category?.id ?? (s ? "uncategorized" : null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    draggingRef.current = true;
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!event.over) { setOverCatKey(null); return; }
    setOverCatKey(resolveCatKey(String(event.over.id)));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    draggingRef.current = false;
    const { active, over } = event;
    const resetDragState = () => { setActiveId(null); setOverCatKey(null); };
    if (!over || active.id === over.id) { resetDragState(); return; }

    const idxA = scripts.findIndex(s => s.id === active.id);
    if (idxA === -1) { resetDragState(); return; }
    const a = scripts[idxA];

    // Case 1: dragged card is uncategorized. Drop target is a whole category
    // (either its container or any card inside it). Move, don't swap.
    if (!a.category) {
      const targetKey = resolveCatKey(String(over.id));
      if (!targetKey || targetKey === "uncategorized") { resetDragState(); return; }
      const targetCatScript = scripts.find(s => s.category?.id === targetKey);
      const targetCat = targetCatScript?.category ?? null;
      if (!targetCat) { resetDragState(); return; }
      const moved = scripts.map(s => s.id === a.id ? { ...s, category: targetCat } : s);
      setScripts(moved);
      resetDragState();
      await fetch(`/api/scripts/${active.id}/category`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: targetCat.id }),
      });
      await refresh();
      return;
    }

    // Case 2: categorized card dropped on another card → swap (existing behavior).
    const idxB = scripts.findIndex(s => s.id === over.id);
    if (idxB === -1) { resetDragState(); return; }
    const b = scripts[idxB];

    const swapped = [...scripts];
    swapped[idxA] = { ...a, category: b.category };
    swapped[idxB] = { ...b, category: a.category };
    [swapped[idxA], swapped[idxB]] = [swapped[idxB], swapped[idxA]];
    setScripts(swapped);
    resetDragState();

    await fetch("/api/scripts/swap", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script_id_a: active.id as string, script_id_b: over.id as string }),
    });
  };

  const isDraggable = filter === "all";

  type CategoryGroup = {
    id: string | null;
    name: string;
    scripts: Script[];
  };

  const groupedScripts = (() => {
    const groups: CategoryGroup[] = [];
    const catMap = new Map<string, CategoryGroup>();
    const uncategorized: Script[] = [];

    for (const s of filteredScripts) {
      if (!s.category) {
        uncategorized.push(s);
        continue;
      }
      let group = catMap.get(s.category.id);
      if (!group) {
        group = { id: s.category.id, name: s.category.name, scripts: [] };
        catMap.set(s.category.id, group);
        groups.push(group);
      }
      group.scripts.push(s);
    }
    if (uncategorized.length > 0) {
      groups.push({ id: null, name: "Uncategorized", scripts: uncategorized });
    }
    return groups;
  })();

  const hasCategories = groupedScripts.length > 1 || (groupedScripts.length === 1 && groupedScripts[0]?.id !== null);

  return (
    <div className="p-5">
      {/* Filter bar */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="flex items-center justify-between mb-4"
      >
        <div className="flex items-center gap-1.5 relative">
          {(["all", "running", "looping", "idle"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`relative text-xs px-3 py-1 rounded font-medium capitalize z-[1] transition-colors duration-200 ${
                filter === f
                  ? "text-white"
                  : "text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800"
              }`}
            >
              {filter === f && (
                <motion.span
                  layoutId="filter-pill"
                  className="absolute inset-0 bg-blue-500 rounded"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative z-[1]">{f === "all" ? "All" : f}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowCategories(true)}
            className="text-xs border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-800 px-3 py-1.5 rounded font-medium"
            title="Manage categories"
          >
            Categories
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowUpload(true)}
            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded font-medium"
          >
            + Add Script
          </motion.button>
        </div>
      </motion.div>

      {/* Card grid */}
      <AnimatePresence mode="popLayout">
        {filteredScripts.length === 0 ? (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-gray-400 mt-4"
          >
            No scripts match this filter.
          </motion.p>
        ) : hasCategories ? (
          isDraggable ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={() => { draggingRef.current = false; setActiveId(null); setOverCatKey(null); }}
            >
              <SortableContext
                items={filteredScripts.map(s => s.id)}
                strategy={activeIsUncategorized ? noopStrategy : swapStrategy}
              >
                <div className="space-y-4">
                  {groupedScripts.map((group) => {
                    const key = group.id ?? "uncategorized";
                    return (
                      <CategorySection
                        key={key}
                        group={group}
                        onRun={handleRun}
                        onLoop={handleLoop}
                        onStop={handleStop}
                        onLogs={setLogsFor}
                        isDraggable
                        highlighted={activeIsUncategorized && overCatKey === key && key !== "uncategorized"}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="space-y-4">
              {groupedScripts.map((group) => (
                <CategorySection
                  key={group.id ?? "uncategorized"}
                  group={group}
                  onRun={handleRun}
                  onLoop={handleLoop}
                  onStop={handleStop}
                  onLogs={setLogsFor}
                  isDraggable={false}
                />
              ))}
            </div>
          )
        ) : isDraggable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => { draggingRef.current = false; setActiveId(null); setOverCatKey(null); }}
          >
            <SortableContext items={filteredScripts.map(s => s.id)} strategy={swapStrategy}>
              <div className="grid grid-cols-3 gap-3">
                {filteredScripts.map((s, i) => (
                  <SwappableScriptCard
                    key={s.id}
                    script={s}
                    onRun={handleRun}
                    onLoop={handleLoop}
                    onStop={handleStop}
                    onLogs={() => setLogsFor(s)}
                    index={hasLoaded.current ? 0 : i}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <AnimatePresence mode="popLayout">
              {filteredScripts.map((s, i) => (
                <StaticScriptCard
                  key={s.id}
                  script={s}
                  onRun={handleRun}
                  onLoop={handleLoop}
                  onStop={handleStop}
                  onLogs={() => setLogsFor(s)}
                  index={i}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={refresh} />}
      </AnimatePresence>
      <AnimatePresence>
        {logsFor && <LogDrawer scriptId={logsFor.id} scriptName={logsFor.name} onClose={() => setLogsFor(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showCategories && <CategoryManagerModal onClose={() => { setShowCategories(false); refresh(); }} />}
      </AnimatePresence>
    </div>
  );
}
