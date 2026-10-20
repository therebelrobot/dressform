# dressform — the drafting service.
# Bundled to a single file so the runtime image has no import resolution to do.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx esbuild src/server/index.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --outfile=dist/server.js

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8091
COPY --from=build /app/dist/server.js ./server.js
EXPOSE 8091
USER node
CMD ["node", "server.js"]
