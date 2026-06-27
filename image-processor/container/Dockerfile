# Phase 3.5 sharp container. Native sharp can't run in a Workers isolate, so processing lives
# here. Cloudflare builds this image and the image-processor worker forwards bytes to it.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs process-image.mjs ./

EXPOSE 8080
CMD ["node", "server.mjs"]
