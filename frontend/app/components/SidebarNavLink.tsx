"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  href: string;
  label: string;
  /** When set, the link is active whenever the pathname starts with this prefix. */
  activeMatch?: "exact" | "prefix";
  /** Draws a bottom border — used by the Dashboard link at the top of the rail. */
  withBottomBorder?: boolean;
  /** Draws a top border. */
  withTopBorder?: boolean;
};

export default function SidebarNavLink({
  href,
  label,
  activeMatch = "exact",
  withBottomBorder = false,
  withTopBorder = false,
}: Props) {
  const pathname = usePathname();
  const active =
    activeMatch === "prefix"
      ? pathname?.startsWith(href)
      : pathname === href;

  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-4 py-2.5 text-[12.5px] font-medium transition-colors duration-200
        ${withTopBorder ? "border-t border-gray-200 dark:border-neutral-800" : ""}
        ${withBottomBorder ? "border-b border-gray-200 dark:border-neutral-800" : ""}
        ${
          active
            ? "text-blue-600 bg-blue-50/40 dark:bg-blue-900/10"
            : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-neutral-800/60"
        }`}
    >
      {label}
    </Link>
  );
}
