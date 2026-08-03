"use client";

import { useState } from "react";
import Link from "next/link";
import pLimit from "p-limit";

const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/i;

const MAX_LINKS = 5;
const CONCURRENCY = 2;

type Status = "pending" | "converting" | "done" | "error";

type Item = {
  id: string;
  url: string;
  status: Status;
  error?: string;
  blobUrl?: string;
  filename?: string;
};

function parseFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "audio.mp3";
  const starMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch) return decodeURIComponent(starMatch[1]);
  const plainMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return plainMatch ? plainMatch[1] : "audio.mp3";
}

export default function Home() {
  const [rawText, setRawText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function convertOne(item: Item) {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: "converting" } : i))
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

    const limit = pLimit(CONCURRENCY);
    await Promise.all(newItems.map((item) => limit(() => convertOne(item))));
  }

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
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                    {item.url}
                  </p>
                  <StatusLabel item={item} />
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

function StatusLabel({ item }: { item: Item }) {
  switch (item.status) {
    case "pending":
      return <p className="text-xs text-zinc-500">Na fila…</p>;
    case "converting":
      return (
        <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
          Convertendo…
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
