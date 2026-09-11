FROM node:24-alpine

WORKDIR /app

# RAVIN backend dependencies.
# Use npm install so Render can recover if package.json changes before
# package-lock.json is regenerated.
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .
RUN chmod +x start.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["./start.sh"]
