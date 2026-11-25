# GenSSL

局域网 HTTPS 自建 SSL 证书管理工具的前后端分离项目。

目标是通过 Web 页面管理私有根 CA，并为局域网服务器签发带 **IP SAN** 的 HTTPS 证书。当前已实现根 CA 的创建、详情查看和公钥证书下载（纯 Node.js + `node-forge`，不依赖本机 OpenSSL / WSL）。下载支持可配置的公共文件名，以及 `.crt` / `.cer` / `.pem` 扩展名（内容均为同一份 PEM 证书；内部存储仍为 `rootCA.crt` / `rootCA.key`）。服务器证书签发、Nginx 配置与客户端指引仍为骨架。

## 技术栈

| 端 | 技术 | 版本 |
| --- | --- | --- |
| 前端 | React | 19.3.1 |
| 前端 | Ant Design | 6.7.2 |
| 前端 | Vite | 8.3.8 |
| 前端 | TypeScript | 5.9.3 |
| 前端 | react-router-dom / axios / @tanstack/react-query / dayjs / @ant-design/icons | 见 `frontend/package.json` |
| 后端 | NestJS（@nestjs/common、core、platform-express） | 12.6.1 |
| 后端 | TypeScript | 6.0.3 |

纯 Node.js 项目，开发与构建不依赖本机 OpenSSL、Linux 或 WSL，Windows / macOS / Linux 均可直接运行。

## 目录结构

```text
GenSSL/
├── README.md
├── package.json          # npm workspaces，一键同时启动前后端
├── backend/              # NestJS + TypeScript
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       ├── health/       # 健康检查
│       ├── ca/           # 根 CA（已实现）
│       ├── certs/        # 服务器证书（骨架）
│       ├── nginx/        # Nginx 配置生成（骨架）
│       └── guides/       # 客户端信任指引（骨架）
└── frontend/             # Vite + React 19 + Ant Design 6 + TypeScript
    └── src/
        ├── layouts/      # 侧边栏布局
        ├── pages/        # 各功能页面骨架
        └── api/          # HTTP 客户端与接口封装占位
```

## 环境要求

- Node.js 20 或更高版本
- npm 9 或更高版本（建议使用 npm 10+）

## 安装

在项目根目录执行：

```bash
cd GenSSL
npm install
```

会同时安装根目录、`backend` 和 `frontend` 的依赖。

也可以分别进入子目录安装：

```bash
cd backend && npm install
cd ../frontend && npm install
```

## 开发启动

### 方式一：根目录一键启动

```bash
npm run dev
```

会同时启动：

- 后端：http://127.0.0.1:18087 （接口前缀 `/api`）
- 前端：http://127.0.0.1:3085 （Vite 将 `/api` 代理到后端 18087 端口）

### 方式二：分开展开

终端 1：

```bash
npm run dev:backend
# 或
cd backend && npm run start:dev
```

终端 2：

```bash
npm run dev:frontend
# 或
cd frontend && npm run dev
```

浏览器访问：http://127.0.0.1:3085

## 构建

```bash
npm run build
```

或分别构建：

```bash
npm run build:backend
npm run build:frontend
```

后端构建产物在 `backend/dist`，可用 `cd backend && npm run start` 启动（默认监听 18087）。  
前端构建产物在 `frontend/dist`。

## 页面与接口

**页面**

1. 概览：根 CA 是否已创建，以及 CN / 有效期
2. 根 CA：创建、详情、按公共文件名下载根证书（已可用，支持 `.crt` / `.cer` / `.pem`）
3. 签发服务器证书（骨架）
4. 证书管理：列表、详情、下载（骨架）
5. Nginx 配置生成器（骨架）
6. 客户端信任指引（骨架）

**后端 API 前缀：** `/api`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康检查（已可用） |
| GET | `/api/ca` | 查询根 CA 状态与详情（已可用，不含私钥；含 `publicFileName` / `suggestedFileName`） |
| POST | `/api/ca` | 创建根 CA（已可用；可选 `publicFileName`；已存在时需 `overwrite: true`，否则返回 409） |
| GET | `/api/ca/download` | 下载根证书公钥（已可用；查询参数 `filename`、`format=crt / cer / pem`；按公共文件名返回 `Content-Disposition`；绝不提供 `rootCA.key`） |
| GET | `/api/certs` | 服务器证书列表 |
| POST | `/api/certs` | 签发服务器证书 |
| GET | `/api/certs/:name` | 证书详情 / 验证 |
| GET | `/api/certs/:name/download` | 下载 Nginx 证书包 |
| POST | `/api/nginx/config` | 生成 Nginx 配置 |
| GET | `/api/guides/windows-trust` | Windows 客户端安装说明 |

根 CA 证书与私钥保存在 `backend/data/ssl-ca/ca/`（已加入 `.gitignore`）。RSA 4096 / 8192 位密钥生成可能较慢，请在页面上等待完成。

## 当前进度

已完成：标准前后端工程、中文界面布局与路由、API 模块骨架、CORS、开发代理、安装与构建，以及根 CA 的创建、详情与按公共文件名下载（`.crt` / `.cer` / `.pem`）。

未实现：服务器证书签发与验证、Nginx 配置内容生成、客户端信任指引正文。
