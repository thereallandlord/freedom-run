# Сборка игры и лёгкий сервер к ней. Одним образом, чтобы деплой был один.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# 🔴 Ключи Supabase нужны ИМЕННО НА СБОРКЕ: Vite вшивает их в бандл, в рантайме
# читать неоткуда. Без них игра соберётся, но онлайн-комнаты работать не будут —
# транспорт молча уйдёт в режим «только вкладки одного браузера».
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# BUILD_ID нужен сторожу свежести: страница сверяет его с version.json.
RUN export BUILD_ID=$(date +%s) && npx vite build && node scripts/write-version.mjs dist $BUILD_ID

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8080
CMD ["node", "server/index.mjs"]
