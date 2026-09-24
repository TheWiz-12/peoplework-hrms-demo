# Production image: database credentials and secrets are injected by the platform,
# never copied into this image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY scripts ./scripts
COPY src ./src
COPY server ./server
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-server ./build-server
COPY --from=build /app/scripts ./scripts
RUN mkdir -p /app/.data && chown node:node /app/.data
EXPOSE 3001
USER node
CMD ["node", "build-server/main.js"]
