"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";

interface SettingTooltipProps {
  label: string;
  text: string;
}

/**
 * A small, accessible info tooltip: shown on hover, keyboard focus, or
 * click/tap, and dismissed on mouse-leave, blur, or Escape. Built from
 * existing dependencies only (React state + Tailwind + a lucide-react
 * icon already used elsewhere in this app) rather than a new UI library.
 */
export default function SettingTooltip({ label, text }: SettingTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? tooltipId : undefined}
        aria-label={`More information about ${label}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="inline-flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <Info size={14} />
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-1/2 top-full z-10 mt-1 w-56 -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1.5 text-xs leading-snug text-white shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
