"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type StatusData = {
  ok: boolean;
  ytdlp: { installed: boolean; version: string | null };
  ffmpeg: { installed: boolean; version: string | null };
  cookies: { configured: boolean; source: "env" | "runtime" | null };
  tmpdir: { writable: boolean };
  uptimeSec: number;
};

type VerifyResult = {
  valid: boolean;
  reason?: string;
  detail?: string;
};

async function callApi(path: string, passphrase: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "x-setup-passphrase": passphrase,
    },
  });
}

export default function SetupPage() {
  const [gate, setGate] = useState<"locked" | "checking" | "unlocked">("locked");
  const [passphraseInput, setPassphraseInput] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);

  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [cookiesText, setCookiesText] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [verifyState, setVerifyState] = useState<"idle" | "verifying" | "done" | "error">("idle");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refreshStatus(pass: string) {
    try {
      const res = await callApi("/api/status", pass, { method: "GET" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setStatusData(data);
        setStatusError(null);
      } else {
        setStatusData(null);
        setStatusError(data?.error ?? `falha ao consultar status (HTTP ${res.status})`);
      }
    } catch (err) {
      setStatusData(null);
      setStatusError(err instanceof Error ? err.message : "erro desconhecido ao consultar status");
    }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setGate("checking");
    setGateError(null);

    try {
      const res = await callApi("/api/status", passphraseInput, { method: "GET" });
      if (res.status === 401) {
        setGate("locked");
        setGateError("Senha incorreta.");
        return;
      }
      const data = await res.json().catch(() => null);
      setPassphrase(passphraseInput);
      setGate("unlocked");
      if (res.ok) {
        setStatusData(data);
        setStatusError(null);
      } else {
        setStatusData(null);
        setStatusError(data?.error ?? `falha ao consultar status (HTTP ${res.status})`);
      }
    } catch (err) {
      setGate("locked");
      setGateError(err instanceof Error ? err.message : "erro desconhecido");
    }
  }

  useEffect(() => {
    if (gate !== "unlocked") return;
    const interval = setInterval(() => refreshStatus(passphrase), 10_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, passphrase]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCookiesText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function handleSaveCookies() {
    setSaveState("saving");
    setSaveError(null);
    setVerifyResult(null);
    setVerifyState("idle");

    try {
      const res = await callApi("/api/admin/cookies", passphrase, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookiesText }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSaveState("error");
        setSaveError(data?.error ?? `falha ao salvar (HTTP ${res.status})`);
        return;
      }
      setSaveState("saved");
      await refreshStatus(passphrase);
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "erro desconhecido");
    }
  }

  async function handleVerify() {
    setVerifyState("verifying");
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const res = await callApi("/api/admin/cookies/verify", passphrase, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setVerifyState("error");
        setVerifyError(data?.error ?? `falha ao testar (HTTP ${res.status})`);
        return;
      }
      setVerifyState("done");
      setVerifyResult(data);
    } catch (err) {
      setVerifyState("error");
      setVerifyError(err instanceof Error ? err.message : "erro desconhecido");
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main className="flex flex-1 w-full max-w-2xl flex-col gap-8 py-16 px-6">
        <header className="flex flex-col gap-2">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Voltar
          </Link>
          <h1 className="text-2xl leading-tight tracking-tight text-zinc-950 dark:text-zinc-50">
            Configurar <span className="font-extrabold">cookies</span>
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Use isso quando o conversor mostrar erro de{" "}
            <span className="font-semibold">bloqueio do YouTube</span>. Leva uns 5 minutos.
          </p>
        </header>

        {gate !== "unlocked" && (
          <form onSubmit={handleUnlock} className="flex flex-col gap-3">
            <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Senha
            </label>
            <input
              type="password"
              value={passphraseInput}
              onChange={(e) => setPassphraseInput(e.target.value)}
              className="w-full rounded-xl border border-zinc-300 bg-white p-4 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              autoFocus
            />
            {gateError && (
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">{gateError}</p>
            )}
            <button
              type="submit"
              disabled={gate === "checking"}
              className="self-start rounded-full bg-zinc-950 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {gate === "checking" ? "Entrando…" : "Entrar"}
            </button>
          </form>
        )}

        {gate === "unlocked" && (
          <>
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Status</h2>
                <button
                  onClick={() => refreshStatus(passphrase)}
                  className="text-xs font-semibold text-zinc-500 hover:text-zinc-300"
                >
                  Atualizar
                </button>
              </div>

              {statusError && (
                <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                  {statusError} (pode ser cold start do Render — espera uns 30-60s e clica em
                  Atualizar)
                </p>
              )}

              {statusData && (
                <div className="flex flex-wrap gap-2">
                  <Badge ok label="Worker online" />
                  <Badge
                    ok={statusData.ytdlp.installed}
                    label={`yt-dlp${statusData.ytdlp.version ? ` ${statusData.ytdlp.version}` : ""}`}
                  />
                  <Badge
                    ok={statusData.ffmpeg.installed}
                    label={statusData.ffmpeg.installed ? "ffmpeg ok" : "ffmpeg ausente"}
                  />
                  <Badge
                    ok={statusData.cookies.configured}
                    label={
                      statusData.cookies.configured
                        ? `cookies configurados (${statusData.cookies.source === "env" ? "fixo" : "manual"})`
                        : "cookies não configurados"
                    }
                  />
                  <Badge ok={statusData.tmpdir.writable} label="disco ok" />
                </div>
              )}
            </section>

            <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                Passo a passo
              </h2>
              <ol className="flex flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <li>
                  <span className="font-bold">1.</span> Instale a extensão{" "}
                  <a
                    href="https://chromewebstore.google.com/search/Get%20cookies.txt%20LOCALLY"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline"
                  >
                    Get cookies.txt LOCALLY
                  </a>{" "}
                  no seu navegador.
                </li>
                <li>
                  <span className="font-bold">2.</span> Abra o{" "}
                  <a
                    href="https://www.youtube.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline"
                  >
                    youtube.com
                  </a>{" "}
                  e faça login (de preferência com uma conta que não seja a sua principal).
                </li>
                <li>
                  <span className="font-bold">3.</span> Clique no ícone da extensão, exporte os
                  cookies e baixe o arquivo <span className="font-semibold">cookies.txt</span>.
                </li>
                <li>
                  <span className="font-bold">4.</span> Escolha esse arquivo abaixo (ou cole o
                  conteúdo dele na caixa de texto).
                </li>
              </ol>

              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                onChange={handleFileChange}
                className="text-sm text-zinc-600 dark:text-zinc-400"
              />

              <textarea
                value={cookiesText}
                onChange={(e) => setCookiesText(e.target.value)}
                placeholder="# Netscape HTTP Cookie File&#10;.youtube.com  TRUE  /  ..."
                rows={5}
                className="w-full resize-none rounded-xl border border-zinc-300 bg-white p-4 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />

              {saveError && (
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">{saveError}</p>
              )}
              {saveState === "saved" && (
                <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                  Cookies salvos!
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleSaveCookies}
                  disabled={!cookiesText.trim() || saveState === "saving"}
                  className="rounded-full bg-zinc-950 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  {saveState === "saving" ? "Salvando…" : "Salvar cookies"}
                </button>

                <button
                  onClick={handleVerify}
                  disabled={!statusData?.cookies.configured || verifyState === "verifying"}
                  className="rounded-full border border-zinc-300 px-6 py-3 text-sm font-bold text-zinc-800 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {verifyState === "verifying" ? "Testando… (até 30s)" : "Testar agora"}
                </button>
              </div>

              {verifyError && (
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                  {verifyError}
                </p>
              )}
              {verifyResult && (
                <p
                  className={`text-sm font-semibold ${
                    verifyResult.valid
                      ? "text-green-600 dark:text-green-400"
                      : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {verifyResult.valid
                    ? "Cookies válidos — está funcionando!"
                    : "Cookies não funcionaram (expiraram ou o bloqueio continua) — repita os passos acima com um login novo."}
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        ok
          ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
          : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
      {label}
    </span>
  );
}
