const express = require("express");
const { spawn, execFile } = require("child_process");
const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.WORKER_API_KEY;
const YT_DLP_TIMEOUT_MS = 120_000;
const VERIFY_TIMEOUT_MS = 30_000;
const TEST_VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/i;

// Cookies do YouTube: usados quando o IP do worker é bloqueado com
// "Sign in to confirm you're not a bot". Duas formas de configurar:
// - no boot, via env var YT_DLP_COOKIES_B64 (base64 de um cookies.txt)
// - em runtime, via POST /admin/cookies (usado pela página /setup)
// Ambas escrevem no mesmo COOKIES_PATH.
const COOKIES_PATH = path.join(os.tmpdir(), "yt-dlp-cookies.txt");
let cookiesReady = false;
let cookiesSource = null; // "env" | "runtime" | null

function parseCookieRows(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"));
}

function looksLikeNetscapeFormat(text) {
  const rows = parseCookieRows(text);
  if (rows.length === 0) return false;
  const wellFormed = rows.filter((r) => r.length === 7);
  return wellFormed.length / rows.length >= 0.8;
}

function hasYoutubeCookies(text) {
  // campo 0 de cada linha é o domínio do cookie — precisa ter pelo menos
  // um cookie cujo domínio seja (sub.)youtube.com, não só "menciona" a
  // string em algum lugar (isso deixava passar cookies só do
  // chromewebstore.google.com, por exemplo).
  return parseCookieRows(text).some((r) => /(^|\.)youtube\.com$/i.test(r[0] ?? ""));
}

function writeCookiesFile(text, source) {
  const tmpPath = `${COOKIES_PATH}.tmp`;
  fsSync.writeFileSync(tmpPath, text, "utf8");
  fsSync.renameSync(tmpPath, COOKIES_PATH);
  cookiesReady = true;
  cookiesSource = source;
}

if (process.env.YT_DLP_COOKIES_B64) {
  try {
    const text = Buffer.from(process.env.YT_DLP_COOKIES_B64, "base64").toString("utf8");
    writeCookiesFile(text, "env");
    console.log("cookies do YouTube carregados a partir de YT_DLP_COOKIES_B64");
  } catch (err) {
    console.error("falha ao decodificar YT_DLP_COOKIES_B64:", err);
  }
}

function getVersion(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.toString().trim().split("\n")[0]);
    });
  });
}

let cachedYtDlpVersion; // undefined = ainda não checou, null = não instalado
let cachedFfmpegVersion;

const app = express();
app.use(express.json({ limit: "2mb" })); // cookies.txt pode passar de 100kb em contas com muitos cookies

function requireApiKey(req, res) {
  if (!API_KEY || req.headers["x-api-key"] !== API_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

app.get("/health", (_req, res) => res.status(200).send("ok"));

app.get("/status", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  if (cachedYtDlpVersion === undefined) {
    cachedYtDlpVersion = await getVersion("yt-dlp", ["--version"]);
  }
  if (cachedFfmpegVersion === undefined) {
    cachedFfmpegVersion = await getVersion("ffmpeg", ["-version"]);
  }

  let tmpWritable = true;
  try {
    const probe = path.join(os.tmpdir(), `.probe-${crypto.randomUUID()}`);
    fsSync.writeFileSync(probe, "x");
    fsSync.unlinkSync(probe);
  } catch {
    tmpWritable = false;
  }

  res.json({
    ok: true,
    ytdlp: { installed: cachedYtDlpVersion !== null, version: cachedYtDlpVersion },
    ffmpeg: { installed: cachedFfmpegVersion !== null, version: cachedFfmpegVersion },
    cookies: { configured: cookiesReady, source: cookiesSource },
    tmpdir: { writable: tmpWritable },
    uptimeSec: Math.round(process.uptime()),
  });
});

app.post("/admin/cookies", (req, res) => {
  if (!requireApiKey(req, res)) return;

  const { cookiesText } = req.body ?? {};
  if (typeof cookiesText !== "string" || !cookiesText.trim()) {
    return res.status(400).json({ error: "cookiesText vazio ou ausente" });
  }
  if (!looksLikeNetscapeFormat(cookiesText)) {
    return res.status(400).json({
      error:
        "isso não parece um cookies.txt válido (formato Netscape) — confira se escolheu o arquivo certo",
    });
  }
  if (!hasYoutubeCookies(cookiesText)) {
    return res.status(400).json({
      error:
        "esse arquivo não tem nenhum cookie do youtube.com — parece que a aba ativa era outra (ex: a loja de extensões) quando você exportou. Abra o youtube.com, deixe ESSA aba em foco, clique no ícone da extensão de novo e exporte a partir dela",
    });
  }

  try {
    writeCookiesFile(cookiesText, "runtime");
    console.log("cookies do YouTube atualizados via /admin/cookies (runtime)");
    res.json({ ok: true, cookiesConfigured: true });
  } catch (err) {
    console.error("falha ao gravar cookies via /admin/cookies:", err);
    res.status(500).json({ error: `falha ao salvar cookies: ${err.message}` });
  }
});

app.post("/admin/cookies/verify", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  if (!cookiesReady) {
    return res.status(400).json({ error: "nenhum cookie configurado ainda" });
  }

  // sem --extractor-args player_client=android aqui: esse cliente não suporta
  // cookies (o yt-dlp simplesmente o ignora quando --cookies é passado), então
  // forçá-lo faria a checagem cair num cliente inconsistente com o que o
  // /convert realmente vai usar
  const child = spawn("yt-dlp", [
    "--cookies",
    COOKIES_PATH,
    "--simulate",
    "--skip-download",
    TEST_VIDEO_URL,
  ]);

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const killTimer = setTimeout(() => child.kill("SIGKILL"), VERIFY_TIMEOUT_MS);

  child.on("close", (code) => {
    clearTimeout(killTimer);
    if (res.headersSent) return;

    if (code === 0) {
      return res.json({ ok: true, valid: true });
    }

    const blocked = /sign in to confirm/i.test(stderr);
    console.error(`/admin/cookies/verify falhou [${blocked ? "expired_or_blocked" : "unknown_error"}]:\n${stderr.slice(-2000)}`);
    res.json({
      ok: true,
      valid: false,
      reason: blocked ? "expired_or_blocked" : "unknown_error",
      detail: stderr.trim().split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300),
    });
  });

  child.on("error", (err) => {
    clearTimeout(killTimer);
    if (!res.headersSent) {
      res.status(500).json({ error: `erro ao rodar verificação: ${err.message}` });
    }
  });
});

app.post("/convert", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const { url } = req.body ?? {};
  if (typeof url !== "string" || !YOUTUBE_URL_RE.test(url)) {
    return res.status(400).json({ error: "url inválida" });
  }

  const tmpDir = path.join(os.tmpdir(), crypto.randomUUID());
  await fs.mkdir(tmpDir, { recursive: true });

  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  const args = [
    "-x",
    "--audio-format",
    "mp3",
    "--no-playlist",
    "-o",
    path.join(tmpDir, "%(title)s.%(ext)s"),
    url,
  ];

  if (cookiesReady) {
    // cliente "android" não suporta cookies (yt-dlp ignora --extractor-args
    // player_client=android quando --cookies é passado) — com cookies
    // configurados, deixa o yt-dlp escolher o cliente padrão, que já lida
    // com cookies corretamente.
    args.push("--cookies", COOKIES_PATH);
  } else {
    // sem cookies, forçar o cliente android reduz bastante o bloqueio de
    // bot-detection do YouTube em IPs de datacenter.
    args.push("--extractor-args", "youtube:player_client=android");
  }

  const child = spawn("yt-dlp", args);

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, YT_DLP_TIMEOUT_MS);

  child.on("close", async (code, signal) => {
    clearTimeout(killTimer);

    if (res.headersSent) {
      return cleanup();
    }

    if (code !== 0) {
      await cleanup();
      const lastLines = stderr
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-5)
        .join(" | ")
        .slice(0, 500);
      const reason = timedOut
        ? `timeout de ${YT_DLP_TIMEOUT_MS / 1000}s excedido`
        : `código de saída ${code}${signal ? ` (sinal ${signal})` : ""}`;
      console.error(`yt-dlp falhou [${reason}] url=${url}\n${stderr.slice(-2000)}`);
      const botBlocked = /sign in to confirm/i.test(stderr);
      const botHint = botBlocked
        ? cookiesReady
          ? " — os cookies configurados parecem ter expirado, atualize em /setup"
          : " — nenhum cookie configurado ainda, configure em /setup"
        : "";
      return res.status(502).json({
        error: `yt-dlp falhou (${reason})${lastLines ? `: ${lastLines}` : ""}${botHint}`,
      });
    }

    try {
      const files = await fs.readdir(tmpDir);
      const mp3File = files.find((f) => f.endsWith(".mp3"));
      if (!mp3File) {
        await cleanup();
        console.error(`mp3 não encontrado em ${tmpDir}, arquivos gerados: ${files.join(", ") || "(nenhum)"}`);
        return res.status(502).json({
          error: `yt-dlp rodou mas não gerou mp3 (arquivos: ${files.join(", ") || "nenhum"})`,
        });
      }

      const filePath = path.join(tmpDir, mp3File);
      const encodedName = encodeURIComponent(mp3File);

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audio.mp3"; filename*=UTF-8''${encodedName}`
      );

      const stream = fsSync.createReadStream(filePath);
      stream.pipe(res);
      stream.on("close", cleanup);
      stream.on("error", (streamErr) => {
        cleanup();
        console.error(`erro ao ler ${filePath}:`, streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `erro ao ler arquivo gerado: ${streamErr.message}` });
        }
      });
    } catch (err) {
      await cleanup();
      console.error("erro inesperado pós-conversão:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: `erro interno após conversão: ${err.message}` });
      }
    }
  });

  child.on("error", async (err) => {
    clearTimeout(killTimer);
    await cleanup();
    console.error(`erro ao iniciar yt-dlp (url=${url}):`, err);
    if (!res.headersSent) {
      const hint =
        err.code === "ENOENT"
          ? "binário yt-dlp não encontrado no PATH do container"
          : err.message;
      res.status(500).json({ error: `erro ao iniciar yt-dlp: ${hint}` });
    }
  });
});

app.listen(PORT, () => {
  console.log(`worker ouvindo na porta ${PORT}`);
});
