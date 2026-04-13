type Props = { total: number; running: number; looping: number; runsToday: number; };

export default function StatsBar({ total, running, looping, runsToday }: Props) {
  const stats = [
    { label: "Total Scripts", value: total,    color: "text-blue-500 dark:text-blue-400" },
    { label: "Running Now",   value: running,  color: "text-green-500 dark:text-green-400" },
    { label: "Looping",       value: looping,  color: "text-amber-500 dark:text-amber-400" },
    { label: "Runs Today",    value: runsToday, color: "text-gray-700 dark:text-gray-200" },
  ];
  return (
    <div className="grid grid-cols-4 gap-2.5 mb-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">{s.label}</p>
          <p className={`text-2xl font-bold tracking-tight ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}
