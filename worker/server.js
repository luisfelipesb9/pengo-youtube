const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.WORKER_API_KEY;
const YT_DLP_TIMEOUT_MS = 120_000;

const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/i;

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.status(200).send("ok"));

app.post("/convert", async (req, res) => {
  if (!API_KEY || req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

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
    "--extractor-args",
    "youtube:player_client=android",
    "-o",
    path.join(tmpDir, "%(title)s.%(ext)s"),
    url,
  ];

  if (process.env.YT_DLP_COOKIES_PATH) {
    args.push("--cookies", process.env.YT_DLP_COOKIES_PATH);
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
      return res.status(502).json({
        error: `yt-dlp falhou (${reason})${lastLines ? `: ${lastLines}` : ""}`,
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
