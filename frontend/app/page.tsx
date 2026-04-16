"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, AnimatePresence } from "motion/react";
import ScriptCard, { Script } from "./components/ScriptCard";
import UploadModal from "./components/UploadModal";
import LogDrawer   from "./components/LogDrawer";
import CategoryManagerModal from "./components/CategoryManagerModal";

type FilterView = "all" | "running" | "idle";

function SortableScriptCard({
  script, onRun, onLoop, onStop, onLogs, index,
}: {
  script: Script;
  onRun:  (id: string) => Promise<void>;
  onLoop: (id: string, interval: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onLogs: () => void;
  index: number;
}) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: script.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.15, delay: index * 0.03, ease: "easeOut" }}
    >
      <ScriptCard
        ref={setNodeRef}
        style={style}
        {...attributes}
        script={script}
        onRun={onRun}
        onLoop={onLoop}
        onStop={onStop}
        onLogs={onLogs}
        dragHandleProps={listeners}
      />
    </motion.div>
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
      layout
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
}: {
  group: { id: string | null; name: string; scripts: Script[] };
  onRun: (id: string) => Promise<void>;
  onLoop: (id: string, interval: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onLogs: (s: Script) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
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
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-3 gap-3">
              {group.scripts.map((s, i) => (
                <StaticScriptCard
                  key={s.id}
                  script={s}
                  onRun={onRun}
                  onLoop={onLoop}
                  onStop={onStop}
                  onLogs={() => onLogs(s)}
                  index={i}
                />
              ))}
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
  const [activeId, setActiveId]     = useState<string | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const orderRef = useRef<string[] | null>(null);
  const hasLoaded = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/scripts");
    if (res.ok) {
      const data: Script[] = await res.json();
      if (orderRef.current) {
        const map = new Map(data.map(s => [s.id, s]));
        const ordered = orderRef.current.map(id => map.get(id)).filter(Boolean) as Script[];
        const inOrder = new Set(orderRef.current);
        for (const s of data) {
          if (!inOrder.has(s.id)) ordered.push(s);
        }
        setScripts(ordered);
      } else {
        setScripts(data);
      }
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
    if (filter === "running") return s.status === "running" || s.loop_enabled;
    if (filter === "idle")    return s.status !== "running" && !s.loop_enabled;
    return true;
  });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = scripts.findIndex(s => s.id === active.id);
    const newIndex = scripts.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...scripts];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    setScripts(reordered);

    const newOrder = reordered.map(s => s.id);
    orderRef.current = newOrder;

    await fetch("/api/scripts/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script_ids: newOrder }),
    });
    orderRef.current = null;
  };

  const activeScript = activeId ? scripts.find(s => s.id === activeId) : null;
  const isDraggable = filter === "all";

  // Group scripts by category for display
  type CategoryGroup = {
    id: string | null;
    name: string;
    scripts: Script[];
  };

  const groupedScripts = (() => {
    const groups: CategoryGroup[] = [];
    const seenCats = new Set<string>();
    const uncategorized: Script[] = [];

    // Collect all unique categories in order
    for (const s of filteredScripts) {
      if (!s.categories?.length) {
        uncategorized.push(s);
        continue;
      }
      for (const cat of s.categories) {
        if (!seenCats.has(cat.id)) {
          seenCats.add(cat.id);
          groups.push({ id: cat.id, name: cat.name, scripts: [] });
        }
      }
    }
    // Assign scripts to their categories
    for (const s of filteredScripts) {
      if (!s.categories?.length) continue;
      for (const cat of s.categories) {
        const g = groups.find(g => g.id === cat.id);
        if (g) g.scripts.push(s);
      }
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
          {(["all", "running", "idle"] as const).map(f => (
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
          <div className="space-y-4">
            {groupedScripts.map((group) => (
              <CategorySection
                key={group.id ?? "uncategorized"}
                group={group}
                onRun={handleRun}
                onLoop={handleLoop}
                onStop={handleStop}
                onLogs={setLogsFor}
              />
            ))}
          </div>
        ) : isDraggable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={filteredScripts.map(s => s.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-3 gap-3">
                <AnimatePresence mode="popLayout">
                  {filteredScripts.map((s, i) => (
                    <SortableScriptCard
                      key={s.id}
                      script={s}
                      onRun={handleRun}
                      onLoop={handleLoop}
                      onStop={handleStop}
                      onLogs={() => setLogsFor(s)}
                      index={hasLoaded.current ? 0 : i}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </SortableContext>
            <DragOverlay>
              {activeScript ? (
                <div className="opacity-90 shadow-2xl rounded-xl">
                  <ScriptCard
                    script={activeScript}
                    onRun={handleRun}
                    onLoop={handleLoop}
                    onStop={handleStop}
                    onLogs={() => {}}
                  />
                </div>
              ) : null}
            </DragOverlay>
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
