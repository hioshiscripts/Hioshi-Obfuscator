FROM node:20-slim

WORKDIR /app

# Install curl + tar (needed for the Prometheus install script)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install the Prometheus Lua obfuscator CLI (bundled Lua runtime, no separate lua install needed)
RUN curl -fsSL https://raw.githubusercontent.com/prometheus-lua/Prometheus/master/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
