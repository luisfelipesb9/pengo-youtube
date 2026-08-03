# pengo-youtube — YouTube para MP3

Cole até 5 links do YouTube e baixe o áudio em MP3.

## Arquitetura

```
web/      → Next.js (App Router), deploy na Vercel — UI + proxy
worker/   → Node + Express + Dockerfile (yt-dlp + ffmpeg), deploy no Render
```

A extração/conversão real roda no `worker/`, fora da Vercel, porque o YouTube
costuma bloquear IPs de datacenter (inclusive serverless da Vercel) e rodar
ffmpeg+yt-dlp em função serverless é frágil (limite de tempo, tamanho de
binário, streaming de resposta). O `web/` só recebe os links, repassa pro
worker e faz streaming do MP3 de volta pro navegador — sem storage externo,
sem fila, sem banco de dados.

## Rodando localmente

### 1. Worker

```bash
cd worker
npm install
WORKER_API_KEY=um-secret-qualquer PORT=8787 npm start
```

Requer `yt-dlp` e `ffmpeg` instalados no PATH (`brew install yt-dlp ffmpeg` no macOS).

### 2. Web

```bash
cd web
npm install
cp .env.example .env.local
# preencha WORKER_URL=http://localhost:8787 e WORKER_API_KEY com o mesmo valor do worker
npm run dev
```

Abra http://localhost:3000.

## Deploy

### Worker → Render

1. New → Web Service → conecte o repositório.
2. Root Directory: `worker`.
3. Runtime: Docker (detecta o `Dockerfile` automaticamente).
4. Plano: Free.
5. Env var: `WORKER_API_KEY` (gere com `openssl rand -hex 32`).
6. Deploy e copie a URL pública gerada.

> O plano free do Render "dorme" após inatividade — a primeira conversão
> depois de um tempo parado pode demorar ~30-60s a mais (cold start).

### Web → Vercel

1. Import do repositório no dashboard da Vercel.
2. Root Directory: `web`.
3. Framework preset: Next.js (auto-detectado).
4. Env vars: `WORKER_URL` (URL do Render) e `WORKER_API_KEY` (mesmo valor do worker).
5. Deploy.

Suba o worker primeiro, para já ter a URL pronta ao configurar a Vercel.

## Se o YouTube começar a bloquear (bot detection)

O worker já usa `--extractor-args "youtube:player_client=android"`, que
resolve a maioria dos bloqueios. Se ainda assim aparecer erro de "Sign in to
confirm you're not a bot", o worker já suporta passar cookies pro yt-dlp —
falta só configurar:

1. Instale uma extensão de exportar cookies no navegador (ex. "Get
   cookies.txt LOCALLY", disponível pra Chrome e Firefox).
2. Faça login em youtube.com com uma conta Google — **de preferência uma
   conta secundária/descartável**, já que esses cookies dão acesso à sessão
   logada dessa conta enquanto forem válidos.
3. Com a extensão, exporte os cookies do domínio `youtube.com` em formato
   Netscape → salve como `cookies.txt`.
4. Converta o arquivo pra base64 numa linha só:
   ```bash
   base64 -i cookies.txt | tr -d '\n' | pbcopy   # macOS, já copia pro clipboard
   # ou, no Linux:
   base64 -w0 cookies.txt
   ```
5. No Render → seu serviço → **Environment** → adicione a env var
   `YT_DLP_COOKIES_B64` com esse valor colado.
6. Salve — o Render reinicia o serviço automaticamente e o worker passa a
   usar os cookies em toda conversão.

Cookies de sessão expiram; se o bloqueio voltar depois de um tempo, repita o
processo. Não é necessário fazer isso de cara — só quando o bloqueio
acontecer de fato (o erro na tela vai indicar explicitamente quando for o
caso).
