FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates unzip \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && curl -fsSL https://deno.land/install.sh | sh -s -- -y \
  && mv /root/.deno/bin/deno /usr/local/bin/deno \
  && rm -rf /root/.deno /var/lib/apt/lists/*

# yt-dlp exige, desde a versão 2025.11.12, um runtime JS externo (Deno) pra
# resolver o desafio "n" do YouTube — sem isso, a extração falha com "n
# challenge solving failed" mesmo com cookies válidos, já que isso não tem
# relação nenhuma com autenticação.

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
