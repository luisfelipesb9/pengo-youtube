export function getWorkerBase(): string | null {
  const url = process.env.WORKER_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

export function getWorkerApiKey(): string | null {
  return process.env.WORKER_API_KEY ?? null;
}

export function passphraseOk(request: Request): boolean {
  const expected = process.env.SETUP_PASSPHRASE;
  if (!expected) return false;
  return request.headers.get("x-setup-passphrase") === expected;
}

export function passphraseErrorResponse(): Response {
  return Response.json({ error: "senha incorreta" }, { status: 401 });
}

type ProxyOptions = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

export async function proxyToWorker({ method, path, body }: ProxyOptions): Promise<Response> {
  const workerBase = getWorkerBase();
  const apiKey = getWorkerApiKey();

  if (!workerBase || !apiKey) {
    console.error("[setup] WORKER_URL ou WORKER_API_KEY ausente nas env vars");
    return Response.json(
      { error: "worker não configurado (WORKER_URL/WORKER_API_KEY ausentes)" },
      { status: 500 }
    );
  }

  let workerRes: Response;
  try {
    workerRes = await fetch(`${workerBase}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error(`[setup] falha ao chamar worker (${workerBase}${path}):`, err);
    return Response.json(
      {
        error: `worker indisponível (${workerBase}): ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }

  const rawText = await workerRes.text().catch(() => "");
  let data: unknown = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    // corpo do worker não era JSON — segue com data = null, usa rawText como mensagem
  }

  if (!workerRes.ok) {
    const message =
      (data as { error?: string } | null)?.error ??
      (rawText ? rawText.slice(0, 300) : "erro desconhecido");
    console.error(`[setup] worker respondeu HTTP ${workerRes.status} em ${path}:`, rawText.slice(0, 1000));
    return Response.json({ error: message }, { status: workerRes.status });
  }

  return Response.json(data ?? {}, { status: workerRes.status });
}
