export const maxDuration = 300;

const WORKER_FETCH_TIMEOUT_MS = 280_000;

const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/i;

export async function POST(request: Request) {
  const workerUrl = process.env.WORKER_URL;
  const workerApiKey = process.env.WORKER_API_KEY;

  if (!workerUrl || !workerApiKey) {
    console.error("[convert] WORKER_URL ou WORKER_API_KEY ausente nas env vars");
    return Response.json(
      { error: "worker não configurado (WORKER_URL/WORKER_API_KEY ausentes)" },
      { status: 500 }
    );
  }

  // remove barra(s) final(is) pra não gerar "//convert" se a env var vier com trailing slash
  const workerBase = workerUrl.replace(/\/+$/, "");

  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return Response.json({ error: "body inválido (esperado JSON com { url })" }, { status: 400 });
  }

  if (typeof url !== "string" || !YOUTUBE_URL_RE.test(url)) {
    return Response.json({ error: `url inválida: ${String(url)}` }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_FETCH_TIMEOUT_MS);
  const startedAt = Date.now();

  let workerRes: Response;
  try {
    workerRes = await fetch(`${workerBase}/convert`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": workerApiKey,
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.error(
      `[convert] falha ao chamar worker (${workerBase}) após ${elapsedMs}ms:`,
      err
    );
    return Response.json(
      {
        error: isAbort
          ? `worker não respondeu em ${WORKER_FETCH_TIMEOUT_MS / 1000}s (possível cold start do Render ou vídeo muito longo) — tente de novo`
          : `worker indisponível (${workerBase}): ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!workerRes.ok || !workerRes.body) {
    const rawText = await workerRes.text().catch(() => "");
    let message = rawText || "(resposta vazia)";
    try {
      const data = JSON.parse(rawText);
      if (typeof data?.error === "string") message = data.error;
    } catch {
      // corpo do worker não era JSON (ex: página de erro HTML) — usa o texto cru mesmo
    }
    console.error(`[convert] worker respondeu HTTP ${workerRes.status}:`, rawText.slice(0, 1000));
    return Response.json(
      { error: `worker respondeu HTTP ${workerRes.status}: ${message.slice(0, 300)}` },
      { status: workerRes.status || 502 }
    );
  }

  return new Response(workerRes.body, {
    headers: {
      "content-type": workerRes.headers.get("content-type") ?? "audio/mpeg",
      "content-disposition":
        workerRes.headers.get("content-disposition") ??
        'attachment; filename="audio.mp3"',
    },
  });
}
