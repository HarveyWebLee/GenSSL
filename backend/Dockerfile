# GenSSL 后端生产镜像。
# 构建上下文必须是仓库根目录（本项目使用 npm workspaces）：
#   docker build -f backend/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

# 构建阶段需要 devDependencies（nest cli / typescript）
RUN npm ci

COPY backend ./backend
RUN npm run build -w backend

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=19347
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/backend/dist ./backend/dist

WORKDIR /app/backend
USER node

EXPOSE 19347
CMD ["node", "dist/main.js"]
