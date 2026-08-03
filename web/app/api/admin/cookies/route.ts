import { passphraseErrorResponse, passphraseOk, proxyToWorker } from "@/app/api/_lib/setupAuth";

export async function POST(request: Request) {
  if (!passphraseOk(request)) return passphraseErrorResponse();

  let cookiesText: unknown;
  try {
    ({ cookiesText } = await request.json());
  } catch {
    return Response.json(
      { error: "body inválido (esperado JSON com { cookiesText })" },
      { status: 400 }
    );
  }

  if (typeof cookiesText !== "string") {
    return Response.json({ error: "cookiesText deve ser uma string" }, { status: 400 });
  }

  return proxyToWorker({ method: "POST", path: "/admin/cookies", body: { cookiesText } });
}
