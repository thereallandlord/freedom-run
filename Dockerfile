# Сборка игры и лёгкий сервер к ней. Одним образом, чтобы деплой был один.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# BUILD_ID нужен сторожу свежести: страница сверяет его с version.json.
RUN export BUILD_ID=$(date +%s) && npx vite build && node scripts/write-version.mjs dist $BUILD_ID

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8080
CMD ["node", "server/index.mjs"]
