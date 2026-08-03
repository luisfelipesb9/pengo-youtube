import { passphraseErrorResponse, passphraseOk, proxyToWorker } from "@/app/api/_lib/setupAuth";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!passphraseOk(request)) return passphraseErrorResponse();
  return proxyToWorker({ method: "POST", path: "/admin/cookies/verify" });
}
