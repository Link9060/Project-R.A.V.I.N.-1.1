FROM node:24-alpine

WORKDIR /app

# RAVIN backend dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# OmniRoute 3.8.49 is the latest published npm version currently available.
RUN npm install -g omniroute@3.8.49 && npm cache clean --force

COPY . .
RUN chmod +x start.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# Give OmniRoute enough heap for its embedded schedulers/services on Render Free.
ENV OMNIROUTE_MEMORY_MB=384
ENV DATA_DIR=/tmp/omniroute

# Render only needs the RAVIN HTTP port. OmniRoute is private to the container.
EXPOSE 3000

CMD ["./start.sh"]
