export const maxDuration = 300;

const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/i;

export async function POST(request: Request) {
  const workerUrl = process.env.WORKER_URL;
  const workerApiKey = process.env.WORKER_API_KEY;

  if (!workerUrl || !workerApiKey) {
    return Response.json(
      { error: "worker não configurado (WORKER_URL/WORKER_API_KEY)" },
      { status: 500 }
    );
  }

  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return Response.json({ error: "body inválido" }, { status: 400 });
  }

  if (typeof url !== "string" || !YOUTUBE_URL_RE.test(url)) {
    return Response.json({ error: "url inválida" }, { status: 400 });
  }

  let workerRes: Response;
  try {
    workerRes = await fetch(`${workerUrl}/convert`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": workerApiKey,
      },
      body: JSON.stringify({ url }),
    });
  } catch {
    return Response.json({ error: "worker indisponível" }, { status: 502 });
  }

  if (!workerRes.ok || !workerRes.body) {
    const message = await workerRes.text().catch(() => "falha ao converter");
    return Response.json({ error: message || "falha ao converter" }, {
      status: workerRes.status || 502,
    });
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
