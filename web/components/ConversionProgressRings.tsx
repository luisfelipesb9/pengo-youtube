"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface RingData {
  label: string;
  current: number;
  total: number;
  color: string;
  gradientTo: string;
  size: number;
}

function Ring({ data }: { data: RingData }) {
  const strokeWidth = 12;
  const radius = (data.size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const pct = data.total === 0 ? 0 : (data.current / data.total) * 100;
  const offset = ((100 - pct) / 100) * circumference;
  const gradientId = `progress-gradient-${data.label}`;

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <svg
        className="-rotate-90 transform"
        height={data.size}
        width={data.size}
        viewBox={`0 0 ${data.size} ${data.size}`}
        aria-label={`${data.label}: ${data.current} de ${data.total}`}
      >
        <title>{`${data.label}: ${data.current} de ${data.total}`}</title>
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor={data.color} />
            <stop offset="100%" stopColor={data.gradientTo} />
          </linearGradient>
        </defs>
        <circle
          className="text-zinc-200 dark:text-zinc-800"
          cx={data.size / 2}
          cy={data.size / 2}
          fill="none"
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          animate={{ strokeDashoffset: offset }}
          cx={data.size / 2}
          cy={data.size / 2}
          fill="none"
          initial={false}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeDasharray={circumference}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        />
      </svg>
    </div>
  );
}

export function ConversionProgressRings({
  total,
  done,
  converting,
  pending,
  errors,
  overallPct,
  className,
}: {
  total: number;
  done: number;
  converting: number;
  pending: number;
  errors: number;
  overallPct: number;
  className?: string;
}) {
  if (total === 0) return null;

  const rings: RingData[] = [
    {
      label: "PRONTOS",
      current: done,
      total,
      color: "#22C55E",
      gradientTo: "#86EFAC",
      size: 140,
    },
    {
      label: "CONVERTENDO",
      current: converting,
      total,
      color: "#F59E0B",
      gradientTo: "#FCD34D",
      size: 106,
    },
    {
      label: "NA FILA",
      current: pending,
      total,
      color: "#0A84FF",
      gradientTo: "#7DC2FF",
      size: 72,
    },
  ];

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-6 rounded-2xl border border-zinc-200 bg-white px-5 py-5 sm:gap-8 sm:px-6",
        "dark:border-zinc-800 dark:bg-zinc-900",
        className
      )}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.4 }}
    >
      <div className="relative h-[140px] w-[140px] shrink-0">
        {rings.map((ring) => (
          <Ring data={ring} key={ring.label} />
        ))}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-extrabold text-2xl text-zinc-900 dark:text-zinc-50">
            {overallPct}
            <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">%</span>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {rings.map((ring) => (
          <div className="flex flex-col" key={ring.label}>
            <span className="text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
              {ring.label}
            </span>
            <span className="font-bold text-xl" style={{ color: ring.color }}>
              {ring.current}
              <span className="text-zinc-400 dark:text-zinc-600">/{ring.total}</span>
            </span>
          </div>
        ))}
        {errors > 0 && (
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">
            {errors} {errors === 1 ? "com erro" : "com erros"}
          </p>
        )}
      </div>
    </motion.div>
  );
}
