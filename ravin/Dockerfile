FROM node:24-alpine

WORKDIR /app

# RAVIN backend dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# OmniRoute is the local OpenAI-compatible router used by RAVIN.
RUN npm install -g omniroute@3.8.49 && npm cache clean --force

COPY . .
RUN chmod +x start.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV OMNIROUTE_PORT=20128
ENV OMNIROUTE_MEMORY_MB=128
ENV DATA_DIR=/tmp/omniroute

# Render only needs the RAVIN HTTP port. OmniRoute is private to the container.
EXPOSE 3000

CMD ["./start.sh"]
