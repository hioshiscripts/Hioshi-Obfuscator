FROM node:20-slim

WORKDIR /app

# Install git + lua5.1 (Prometheus requires Lua 5.1 / LuaJIT to run from source)
RUN apt-get update && apt-get install -y --no-install-recommends git lua5.1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Clone Prometheus directly from source instead of using the install script
# (avoids GitHub Releases API rate limits on shared build infra)
RUN git clone --depth 1 https://github.com/prometheus-lua/Prometheus.git /opt/prometheus

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
