"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import pLimit from "p-limit";
import { ConversionProgressRings } from "@/components/ConversionProgressRings";
import {
  formatDuration,
  getBatchAverages,
  getItemAverageMs,
  recordBatchDuration,
  recordItemDuration,
} from "@/lib/conversionStats";

const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/i;

const MAX_LINKS = 5;
const CONCURRENCY = 2;
const PROGRESS_TICK_MS = 400;
const MAX_ESTIMATED_PCT = 97;

type Status = "pending" | "converting" | "done" | "error";

type Item = {
  id: string;
  url: string;
  status: Status;
  error?: string;
  blobUrl?: string;
  filename?: string;
  startedAt?: number;
};

function parseFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "audio.mp3";
  const starMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch) return decodeURIComponent(starMatch[1]);
  const plainMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return plainMatch ? plainMatch[1] : "audio.mp3";
}

function itemProgressPct(item: Item, avgItemMs: number, now: number): number {
  switch (item.status) {
    case "pending":
      return 0;
    case "done":
    case "error":
      return 100;
    case "converting": {
      if (!item.startedAt) return 0;
      const elapsed = now - item.startedAt;
      return Math.min(MAX_ESTIMATED_PCT, Math.round((elapsed / avgItemMs) * 100));
    }
  }
}

export default function Home() {
  const [rawText, setRawText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [batchAverages, setBatchAverages] = useState<
    Array<{ n: number; avgMs: number; samples: number }>
  >([]);

  useEffect(() => {
    setBatchAverages(getBatchAverages());
  }, []);

  useEffect(() => {
    const anyConverting = items.some((i) => i.status === "converting");
    if (!anyConverting) return;
    const interval = setInterval(() => setNow(Date.now()), PROGRESS_TICK_MS);
    return () => clearInterval(interval);
  }, [items]);

  async function convertOne(item: Item) {
    const startedAt = Date.now();
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: "converting", startedAt } : i))
    );

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: item.url }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `falha (HTTP ${res.status})`);
      }

      const filename = parseFilename(res.headers.get("content-disposition"));
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      recordItemDuration(Date.now() - startedAt);
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: "done", blobUrl, filename } : i
        )
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: "error",
                error: err instanceof Error ? err.message : "erro desconhecido",
              }
            : i
        )
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const urls = Array.from(
      new Set(
        rawText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      )
    );

    if (urls.length === 0) {
      setSubmitError("Cole pelo menos 1 link do YouTube.");
      return;
    }
    if (urls.length > MAX_LINKS) {
      setSubmitError(`No máximo ${MAX_LINKS} links por vez.`);
      return;
    }
    const invalid = urls.find((u) => !YOUTUBE_URL_RE.test(u));
    if (invalid) {
      setSubmitError(`Link inválido: ${invalid}`);
      return;
    }

    const newItems: Item[] = urls.map((url) => ({
      id: crypto.randomUUID(),
      url,
      status: "pending",
    }));
    setItems(newItems);

    const batchStartedAt = Date.now();
    const limit = pLimit(CONCURRENCY);
    await Promise.all(newItems.map((item) => limit(() => convertOne(item))));

    recordBatchDuration(urls.length, Date.now() - batchStartedAt);
    setBatchAverages(getBatchAverages());
  }

  const avgItemMs = getItemAverageMs();
  const progresses = items.map((item) => itemProgressPct(item, avgItemMs, now));
  const overallPct =
    items.length === 0
      ? 0
      : Math.round(progresses.reduce((sum, p) => sum + p, 0) / items.length);

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main className="flex flex-1 w-full max-w-2xl flex-col gap-8 py-20 px-6">
        <header className="flex flex-col gap-2 text-center sm:text-left">
          <h1 className="text-3xl leading-tight tracking-tight text-zinc-950 dark:text-zinc-50">
            YouTube para <span className="font-extrabold">MP3</span>
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Cole até <span className="font-bold text-zinc-900 dark:text-zinc-100">{MAX_LINKS} links</span> do YouTube,
            um por linha, e baixe o <span className="font-bold text-zinc-900 dark:text-zinc-100">áudio em MP3</span>.
          </p>
          {batchAverages.length > 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Tempo médio, com base nas suas conversões anteriores:{" "}
              {batchAverages
                .map(
                  (b) =>
                    `${b.n} ${b.n === 1 ? "link" : "links"} ≈ ${formatDuration(b.avgMs)}`
                )
                .join(" · ")}
            </p>
          )}
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={"https://www.youtube.com/watch?v=...\nhttps://youtu.be/..."}
            rows={5}
            className="w-full resize-none rounded-xl border border-zinc-300 bg-white p-4 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {submitError && (
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">
              {submitError}
            </p>
          )}
          <button
            type="submit"
            className="self-start rounded-full bg-zinc-950 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Converter
          </button>
        </form>

        {items.length > 0 && (
          <ConversionProgressRings
            total={items.length}
            done={items.filter((i) => i.status === "done").length}
            converting={items.filter((i) => i.status === "converting").length}
            pending={items.filter((i) => i.status === "pending").length}
            errors={items.filter((i) => i.status === "error").length}
            overallPct={overallPct}
          />
        )}

        {items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {items.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                    {item.url}
                  </p>
                  <StatusLabel item={item} progressPct={progresses[index]} />
                </div>
                {item.status === "done" && item.blobUrl && (
                  <a
                    href={item.blobUrl}
                    download={item.filename}
                    className="shrink-0 rounded-full bg-zinc-950 px-4 py-2 text-xs font-bold text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    Baixar MP3
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function StatusLabel({ item, progressPct }: { item: Item; progressPct: number }) {
  switch (item.status) {
    case "pending":
      return <p className="text-xs text-zinc-500">Na fila…</p>;
    case "converting":
      return (
        <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
          Convertendo… {progressPct}%
        </p>
      );
    case "done":
      return (
        <p className="text-xs font-semibold text-green-600 dark:text-green-400">
          Pronto
        </p>
      );
    case "error":
      return (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">
            Erro: {item.error}
          </p>
          {item.error?.includes("/setup") && (
            <Link
              href="/setup"
              className="text-xs font-bold text-zinc-900 underline dark:text-zinc-100"
            >
              Configurar cookies →
            </Link>
          )}
        </div>
      );
  }
}
