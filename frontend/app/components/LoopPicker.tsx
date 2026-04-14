"use client";
import { useState } from "react";

const INTERVAL_PRESETS = ["5m", "15m", "30m", "1h", "6h", "1d"];
const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

type Props = {
  disabled?: boolean;
  onSelect: (interval: string) => void;
  onCancel: () => void;
};

export function formatLoopInterval(interval: string): string {
  if (!interval) return "";
  if (interval.startsWith("schedule:")) {
    const body = interval.slice("schedule:".length);
    const [daysPart, time] = body.split("@");
    const dayKeys = daysPart.split(",");
    const dayLabels: Record<string, string> = {
      mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
    };
    if (dayKeys.length === 7) return `Daily at ${time}`;
    const weekdays = ["mon", "tue", "wed", "thu", "fri"];
    const weekends = ["sat", "sun"];
    if (dayKeys.length === 5 && weekdays.every(d => dayKeys.includes(d))) return `Weekdays at ${time}`;
    if (dayKeys.length === 2 && weekends.every(d => dayKeys.includes(d))) return `Weekends at ${time}`;
    return `${dayKeys.map(d => dayLabels[d] || d).join(", ")} at ${time}`;
  }
  return `every ${interval}`;
}

export default function LoopPicker({ disabled, onSelect, onCancel }: Props) {
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [time, setTime] = useState("06:00");

  const toggleDay = (day: string) => {
    setSelectedDays(prev => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  };

  const startSchedule = () => {
    if (selectedDays.size === 0) return;
    const days = DAYS.filter(d => selectedDays.has(d.key)).map(d => d.key).join(",");
    onSelect(`schedule:${days}@${time}`);
  };

  return (
    <div className="space-y-3">
      {/* Quick intervals */}
      <div>
        <p className="text-[10px] text-gray-400 mb-1.5">Repeat every</p>
        <div className="flex gap-1.5 flex-wrap">
          {INTERVAL_PRESETS.map(interval => (
            <button
              key={interval}
              disabled={disabled}
              onClick={() => onSelect(interval)}
              className="text-xs border border-gray-200 dark:border-neutral-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-600 px-2.5 py-1 rounded disabled:opacity-50"
            >
              {interval}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule picker */}
      <div>
        <p className="text-[10px] text-gray-400 mb-1.5">Schedule</p>
        <div className="flex gap-1 flex-wrap mb-2">
          {DAYS.map(d => (
            <button
              key={d.key}
              disabled={disabled}
              onClick={() => toggleDay(d.key)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                selectedDays.has(d.key)
                  ? "bg-blue-500 text-white border-blue-500"
                  : "border-gray-200 dark:border-neutral-700 hover:border-blue-300 dark:hover:border-blue-600"
              } disabled:opacity-50`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">at</span>
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            disabled={disabled}
            className="text-xs border border-gray-200 dark:border-neutral-700 rounded px-2 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            disabled={disabled || selectedDays.size === 0}
            onClick={startSchedule}
            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded font-medium disabled:opacity-50"
          >
            Start
          </button>
          <button onClick={onCancel} className="text-xs text-gray-400 px-2 ml-auto">Cancel</button>
        </div>
      </div>
    </div>
  );
}
