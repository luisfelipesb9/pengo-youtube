import { passphraseErrorResponse, passphraseOk, proxyToWorker } from "@/app/api/_lib/setupAuth";

export async function GET(request: Request) {
  if (!passphraseOk(request)) return passphraseErrorResponse();
  return proxyToWorker({ method: "GET", path: "/status" });
}
