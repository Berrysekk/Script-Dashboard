"use client";
import { useState } from "react";
import Select from "./Select";

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
const MONTHS = [
  { key: "jan", label: "Jan" }, { key: "feb", label: "Feb" },
  { key: "mar", label: "Mar" }, { key: "apr", label: "Apr" },
  { key: "may", label: "May" }, { key: "jun", label: "Jun" },
  { key: "jul", label: "Jul" }, { key: "aug", label: "Aug" },
  { key: "sep", label: "Sep" }, { key: "oct", label: "Oct" },
  { key: "nov", label: "Nov" }, { key: "dec", label: "Dec" },
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
  if (interval.startsWith("monthly:")) {
    const body = interval.slice("monthly:".length);
    const [dayStr, time] = body.split("@");
    return `${dayStr}${ordinal(parseInt(dayStr))} of month at ${time}`;
  }
  if (interval.startsWith("once:")) {
    const body = interval.slice("once:".length);
    const [datePart, time] = body.split("@");
    return `${datePart} at ${time}`;
  }
  return `every ${interval}`;
}

function ordinal(n: number): string {
  if (n > 3 && n < 21) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

type Tab = "interval" | "weekly" | "monthly" | "once";

export default function LoopPicker({ disabled, onSelect, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>("interval");
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [time, setTime] = useState("06:00");
  const [monthDay, setMonthDay] = useState("1");
  const [onceDate, setOnceDate] = useState("");

  const toggleDay = (day: string) => {
    setSelectedDays(prev => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "interval", label: "Interval" },
    { key: "weekly", label: "Weekly" },
    { key: "monthly", label: "Monthly" },
    { key: "once", label: "Exact date" },
  ];

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-[10px] px-2.5 py-1 rounded font-medium ${
              tab === t.key
                ? "bg-blue-500 text-white"
                : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button onClick={onCancel} className="text-xs text-gray-400 px-2 ml-auto">Cancel</button>
      </div>

      {/* Interval presets */}
      {tab === "interval" && (
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
      )}

      {/* Weekly schedule */}
      {tab === "weekly" && (
        <div>
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
              type="time" value={time} onChange={e => setTime(e.target.value)} disabled={disabled}
              className="text-xs border border-gray-200 dark:border-neutral-700 rounded px-2 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
            />
            <button
              disabled={disabled || selectedDays.size === 0}
              onClick={() => {
                const days = DAYS.filter(d => selectedDays.has(d.key)).map(d => d.key).join(",");
                onSelect(`schedule:${days}@${time}`);
              }}
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded font-medium disabled:opacity-50"
            >
              Start
            </button>
          </div>
        </div>
      )}

      {/* Monthly schedule */}
      {tab === "monthly" && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-400">Day</span>
          <Select
            size="sm"
            value={String(monthDay)}
            onChange={setMonthDay}
            disabled={disabled}
            options={Array.from({ length: 28 }, (_, i) => i + 1).map((d) => ({
              value: String(d),
              label: String(d),
            }))}
          />
          <span className="text-[10px] text-gray-400">at</span>
          <input
            type="time" value={time} onChange={e => setTime(e.target.value)} disabled={disabled}
            className="text-xs border border-gray-200 dark:border-neutral-700 rounded px-2 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            disabled={disabled}
            onClick={() => onSelect(`monthly:${monthDay}@${time}`)}
            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded font-medium disabled:opacity-50"
          >
            Start
          </button>
        </div>
      )}

      {/* Exact date & time */}
      {tab === "once" && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date" value={onceDate} onChange={e => setOnceDate(e.target.value)} disabled={disabled}
            className="text-xs border border-gray-200 dark:border-neutral-700 rounded px-2 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
          <span className="text-[10px] text-gray-400">at</span>
          <input
            type="time" value={time} onChange={e => setTime(e.target.value)} disabled={disabled}
            className="text-xs border border-gray-200 dark:border-neutral-700 rounded px-2 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            disabled={disabled || !onceDate}
            onClick={() => onSelect(`once:${onceDate}@${time}`)}
            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded font-medium disabled:opacity-50"
          >
            Start
          </button>
        </div>
      )}
    </div>
  );
}
