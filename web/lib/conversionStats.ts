const STORAGE_KEY = "pengo:conversion-stats-v1";

// Tempo padrão assumido pra 1a conversão de todas (sem histórico ainda),
// só pra já mostrar algum número em vez de nada.
const DEFAULT_ITEM_MS = 20_000;

type ItemStats = { totalMs: number; samples: number };
type BatchStats = Record<number, { totalMs: number; samples: number }>;

type StoredStats = {
  item: ItemStats;
  batch: BatchStats;
};

function loadStats(): StoredStats {
  if (typeof window === "undefined") return { item: { totalMs: 0, samples: 0 }, batch: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { item: { totalMs: 0, samples: 0 }, batch: {} };
    const parsed = JSON.parse(raw);
    return {
      item: parsed.item ?? { totalMs: 0, samples: 0 },
      batch: parsed.batch ?? {},
    };
  } catch {
    return { item: { totalMs: 0, samples: 0 }, batch: {} };
  }
}

function saveStats(stats: StoredStats) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // localStorage indisponível (modo privado, etc.) — só perde o histórico
  }
}

export function recordItemDuration(ms: number) {
  const stats = loadStats();
  stats.item.totalMs += ms;
  stats.item.samples += 1;
  saveStats(stats);
}

export function getItemAverageMs(): number {
  const stats = loadStats();
  if (stats.item.samples === 0) return DEFAULT_ITEM_MS;
  return stats.item.totalMs / stats.item.samples;
}

export function recordBatchDuration(n: number, ms: number) {
  const stats = loadStats();
  const bucket = stats.batch[n] ?? { totalMs: 0, samples: 0 };
  bucket.totalMs += ms;
  bucket.samples += 1;
  stats.batch[n] = bucket;
  saveStats(stats);
}

export function getBatchAverages(): Array<{ n: number; avgMs: number; samples: number }> {
  const stats = loadStats();
  return Object.entries(stats.batch)
    .map(([n, b]) => ({ n: Number(n), avgMs: b.totalMs / b.samples, samples: b.samples }))
    .sort((a, b) => a.n - b.n);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}min` : `${min}min ${sec}s`;
}
