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
# preencha WORKER_URL=http://localhost:8787, WORKER_API_KEY com o mesmo valor
# do worker, e SETUP_PASSPHRASE com uma senha qualquer (protege a página /setup)
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
4. Env vars: `WORKER_URL` (URL do Render), `WORKER_API_KEY` (mesmo valor do
   worker) e `SETUP_PASSPHRASE` (senha que você vai compartilhar com quem for
   usar a página `/setup` — pode ser qualquer coisa, é só um filtro simples).
5. Deploy.

Suba o worker primeiro, para já ter a URL pronta ao configurar a Vercel.

## Se o YouTube começar a bloquear (bot detection)

O worker já usa `--extractor-args "youtube:player_client=android"`, que
resolve a maioria dos bloqueios. Se ainda assim aparecer erro de "Sign in to
confirm you're not a bot", a própria tela mostra um botão **"Configurar
cookies →"** apontando pra página `/setup`.

> Nem todo erro de conversão é bot-detection. Desde a versão 2025.11.12 o
> yt-dlp exige um runtime JS externo (Deno, já instalado no `Dockerfile`)
> pra resolver o desafio "n" do YouTube — sem isso, a extração falha com "n
> challenge solving failed" mesmo com cookies válidos, e isso não tem nada a
> ver com cookies/autenticação. Se esse erro voltar a aparecer no futuro
> (ex: yt-dlp atualizou e mudou de novo), o `/status` na página `/setup`
> mostra a versão do yt-dlp instalada como primeiro ponto de checagem.

### Caminho principal: página `/setup` (não precisa terminal nem Render)

1. Acesse `<sua-url-da-vercel>/setup` e entre com a `SETUP_PASSPHRASE`.
2. Siga o passo a passo na tela: instalar a extensão "Get cookies.txt
   LOCALLY", logar no YouTube (de preferência com uma conta
   secundária/descartável, já que os cookies dão acesso à sessão logada
   dela) e exportar o `cookies.txt` do domínio `youtube.com`.
3. Escolha o arquivo (ou cole o conteúdo) na página e clique em **"Salvar
   cookies"**.
4. Clique em **"Testar agora"** pra confirmar que funcionou de verdade (a
   página roda uma checagem real, não só confere se o arquivo existe).

Essa via grava os cookies em runtime — funciona até o container do Render
reiniciar (o plano free dorme após inatividade; quando isso acontecer, é só
repetir esse passo na página). Pra quem tem acesso ao dashboard da Render e
quer uma configuração mais durável, veja a opção abaixo.

### Alternativa durável: env var no Render (sobrevive a restarts)

1. Exporte o `cookies.txt` como no passo 2 acima.
2. Converta o arquivo pra base64 numa linha só:
   ```bash
   base64 -i cookies.txt | tr -d '\n' | pbcopy   # macOS, já copia pro clipboard
   # ou, no Linux:
   base64 -w0 cookies.txt
   ```
3. No Render → seu serviço → **Environment** → adicione a env var
   `YT_DLP_COOKIES_B64` com esse valor colado.
4. Salve — o Render reinicia o serviço automaticamente e o worker passa a
   usar os cookies em toda conversão (a página `/setup` mostra
   `cookies configurados (fixo)` quando vêm daqui).

Cookies de sessão expiram; se o bloqueio voltar depois de um tempo, repita o
processo (por qualquer uma das duas vias). Não é necessário fazer isso de
cara — só quando o bloqueio acontecer de fato.
