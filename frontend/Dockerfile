# GenSSL 前端生产镜像。
# 构建上下文必须是仓库根目录（本项目使用 npm workspaces）：
#   docker build -f frontend/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci

COPY frontend ./frontend
RUN npm run build -w frontend

FROM nginx:stable-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 18347
CMD ["nginx", "-g", "daemon off;"]
