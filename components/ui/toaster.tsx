import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

type ToastProps = {
  open: boolean;
  title: string;
  description?: string | null;
  progress?: number | null;
  action?: ReactNode;
};

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
};

export function Toast({ open, title, description, progress, action }: ToastProps) {
  if (!open) return null;

  const percentLabel = formatPercent(progress ?? null);
  const isDeterminate = typeof progress === "number" && Number.isFinite(progress);
  const barWidth = isDeterminate ? `${Math.min(Math.max(progress, 0), 1) * 100}%` : "40%";
  const showFooter = !isDeterminate || Boolean(action);

  return (
    <div className="pointer-events-none fixed left-1/2 top-6 z-50 w-[min(92vw,420px)] -translate-x-1/2">
      <div className="pointer-events-auto rounded-2xl border border-white/15 bg-zinc-950/95 px-5 py-4 shadow-xl backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-white">{title}</p>
              {description && <p className="text-xs text-white/60">{description}</p>}
            </div>
          </div>
          {percentLabel && <span className="text-xs text-white/60 tabular-nums">{percentLabel}</span>}
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={cn("h-full rounded-full bg-white/70", !isDeterminate && "progress-indeterminate")}
            style={{ width: barWidth }}
          />
        </div>
        {showFooter && (
          <div className="mt-3 flex items-center justify-between gap-3">
            {!isDeterminate && <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Working</p>}
            {action && <div className="ml-auto">{action}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
