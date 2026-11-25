# GenSSL

局域网 HTTPS 自建 SSL 证书管理工具。通过 Web 页面完成：创建私有根 CA、签发带 **IP SAN** 的服务器证书、登记目标服务器与部署路径，并将证书文件上传到 RustFS（S3 兼容对象存储）中对应的服务器/路径前缀下。

证书签发使用纯 Node.js + `node-forge`，不依赖本机 OpenSSL / WSL。Windows / Linux / macOS 均可运行。

**安全约定：** `rootCA.key`（根 CA 私钥）只保存在本机 `backend/data/ssl-ca/ca/`，绝不提供下载、不写入数据库、不上传到文件服务器。Nginx 需要的是 `server.key`（服务器私钥），不要与根 CA 私钥混淆。

## 技术栈

| 端 | 技术 | 版本 |
| --- | --- | --- |
| 前端 | React + Ant Design + Vite | 19.3.1 / 6.7.2 / 8.3.8 |
| 后端 | NestJS + TypeORM + node-forge | 12.6.1 / 0.3 / 1.3.3 |
| 数据库 | PostgreSQL 16（Docker） | 主机端口 **19666** |
| 文件存储 | RustFS（S3 兼容，官方镜像 `rustfs/rustfs:latest`） | S3 **19701**，控制台 **19702** |

## 目录结构

```text
GenSSL/
├── docker-compose.yml    # PostgreSQL + RustFS
├── .env.example          # 本地默认配置（复制为 .env）
├── backend/              # NestJS
│   ├── src/ca/           # 根 CA（已实现）
│   ├── src/certs/        # 服务器证书签发 / 校验 / 下载
│   ├── src/servers/      # 目标服务器与部署路径
│   ├── src/storage/      # RustFS（S3 path-style）
│   ├── src/deploy/       # 上传部署记录
│   └── src/overview/     # 概览统计
└── frontend/             # React 19 + Ant Design 6
```

## 环境要求

- Node.js 20 或更高版本（建议 20+ / 22+）
- npm 9 或更高版本
- 完整流程需要 Docker / Docker Compose（用于 PostgreSQL 与 RustFS）

仅创建根 CA 时也需要后端能连上 PostgreSQL（签发、服务器登记、上传记录都存在库中）。请先启动基础设施。

## 1. 启动基础设施

在项目根目录：

```bash
cp .env.example .env    # 可按需修改密码与密钥
docker compose up -d
docker compose ps
```

或：`npm run infra:up`

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:19666` | 库名/用户默认 `genssl`，密码见 `.env`（示例默认为 `genssl`） |
| RustFS S3 API | http://127.0.0.1:19701 | 后端通过 path-style S3 访问 |
| RustFS 控制台 | http://127.0.0.1:19702 | 用 `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY` 登录（示例默认为 `rustfsadmin`） |

修改密钥：编辑 `.env` 中的 `POSTGRES_PASSWORD`、`RUSTFS_ACCESS_KEY`、`RUSTFS_SECRET_KEY`，然后 `docker compose up -d` 重建容器，并同步修改 `DATABASE_URL` 与后端的 RustFS 密钥。

**不要把带默认密钥的服务暴露到公网。** 本地开发未给 RustFS 启用 TLS（没有设置 `RUSTFS_TLS_PATH`），以免和本项目证书流程缠在一起。RustFS 使用 named volume，并通过 `10001:10001` 权限修复容器启动，避免 Windows 绑定目录的权限问题。

停止：`docker compose down` 或 `npm run infra:down`（默认保留数据卷）。

## 2. 安装与启动应用

```bash
cd GenSSL
npm install
# 可选：把根目录 .env 复制到 backend/.env，或直接使用根目录 .env
npm run dev
```

- 前端：http://127.0.0.1:3085 （`/api` 代理到后端）
- 后端：http://127.0.0.1:18087 （接口前缀 `/api`）

也可分开展开：`npm run dev:backend` 与 `npm run dev:frontend`。

后端连接：

- PostgreSQL：`DATABASE_URL=postgres://genssl:genssl@127.0.0.1:19666/genssl`
- RustFS：`RUSTFS_ENDPOINT=http://127.0.0.1:19701`（`forcePathStyle: true`）
- 启动时自动创建存储桶 `RUSTFS_BUCKET`（默认 `genssl`）
- 表结构：默认 `TYPEORM_SYNC=true`，启动时自动同步（开发方便）。生产环境可改为 `false` 并自行管理结构。

## 推荐操作步骤

1. **创建根 CA**（「根 CA」页）：填写主体、密钥长度、有效期、公共文件名等。下载根证书 `.crt` / `.cer` / `.pem` 给客户端安装信任。私钥不会提供下载。
2. **签发服务器证书**（「签发证书」页）：填写一个或多个服务器 IP。SAN 将按如下格式写入并展示（全部为 IP Address 类型，不是 DNS；不要带端口）：

   ```text
   Subject Alternative Name:
       IP Address: 192.168.99.242
       IP Address: 192.168.99.243
       IP Address: 192.168.99.244
   ```

   默认为 RSA 2048、397 天、CA:FALSE、serverAuth。可选附加 DNS 名称。签发后会校验证书链、SAN、有效期以及与私钥是否匹配。
3. **登记目标服务器与路径**（「服务器与路径」页）：例如服务器 `web-01`，路径 `/etc/nginx/ssl`。
4. **上传部署**（「上传部署」页）：选择证书、目标服务器和路径，上传 `server.crt`（或自定义公共文件名）与 `server.key`；可选择同时上传根 CA 公钥。目标路径已有同名文件时需确认覆盖。可查看该前缀下已有文件并重新上传或下载。
5. 将文件从 RustFS（或本地下载的部署包）拷贝到真实 Nginx 服务器对应目录，并配置 `ssl_certificate` / `ssl_certificate_key`。

## 数据模型（PostgreSQL）

- `issued_certificates`：签发记录（名称、CN、IP/DNS SAN、有效期、序列号、指纹、公共文件名等）。证书材料在本地 `backend/data/ssl-ca/certs/<name>/server.crt|server.key`。
- `servers`：目标服务器（名称、主机/IP、说明）。
- `server_paths`：某服务器上的证书部署路径文件夹。
- `deploy_records`：上传记录（证书、服务器、路径、对象键、是否覆盖）。

RustFS 对象键示例：`web-01/etc/nginx/ssl/192.168.99.242.crt`。

## 后端 API（前缀 `/api`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/overview` | 根 CA 状态、证书数、服务器数、RustFS 状态 |
| GET/POST | `/ca` | 查询 / 创建根 CA |
| GET | `/ca/download` | 下载根 CA 公钥（绝不提供 `rootCA.key`） |
| GET/POST | `/certs` | 证书列表 / 签发 |
| GET | `/certs/:name` | 详情与校验 |
| GET | `/certs/:name/download` | `part=bundle\|cert\|key`，部署包不含 rootCA.key |
| GET/POST | `/servers` | 服务器列表 / 创建 |
| GET/PATCH/DELETE | `/servers/:id` | 服务器详情 / 更新 / 删除 |
| POST/PATCH/DELETE | `/servers/:id/paths[/:pathId]` | 路径增改删 |
| GET/POST | `/deploys` | 上传记录 / 执行上传 |
| GET | `/servers/:serverId/paths/:pathId/files` | 列出目标前缀下的文件 |
| GET | `/storage/objects?key=` | 从 RustFS 下载对象（拒绝 rootCA.key） |

## 构建与测试

```bash
npm run build
npm test
```

后端构建产物在 `backend/dist`，前端在 `frontend/dist`。

## 已知限制

- **上传目标是 RustFS 对象存储中的「服务器/路径」前缀**，用于集中管理待部署文件。当前**不会通过 SSH 直接写入远程机器磁盘**。把文件放到真实 Nginx 目录仍需运维拷贝或自行编写同步脚本。
- 根 CA 私钥永不离开管理端主机。
- Nginx 配置生成、Windows 客户端信任指引页面仍为骨架（根证书下载已可用）。

