# GenSSL

局域网 HTTPS 自建 SSL 证书管理工具。通过 Web 页面完成：创建**多棵**私有根 CA、选择根证书签发带 **IP SAN** 的服务器证书、登记目标服务器与部署路径，并将文件分别写入 RustFS 中的两类目录。

证书签发使用纯 Node.js + `node-forge`，不依赖本机 OpenSSL / WSL。Windows / Linux / macOS 均可运行。

**存储约定（无本地证书文件）：**

- **PostgreSQL**：证书元数据，以及根 CA 私钥（`rootCA.key` 只进数据库，永远不得上传、下载或写入 RustFS）。
- **RustFS 证书库（archive/）**：`rootCA.crt`、服务器证书、服务器私钥等管理档案。
- **RustFS 服务器部署目录（deploy/）**：部署到某台服务器 cert 文件夹（或你登记的部署路径），与证书库严格分开。
- 本产品**不会**把证书、私钥或元数据文件写到 `backend/data`、`ssl-ca` 或任何本地目录。

Nginx 需要的是服务器私钥，不要与根 CA 私钥混淆。签发和「部署到服务器 cert 目录」是独立步骤，签发成功不会自动部署。

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
├── scripts/reset-local.cjs / reset-product.sh  # 清遗留本地目录，并提示清卷命令
├── backend/              # NestJS
│   ├── src/ca/           # 多根 CA（私钥仅存数据库）
│   ├── src/certs/        # 服务器证书签发 / 校验 / 下载
│   ├── src/archive/      # 证书库（archive/）
│   ├── src/servers/      # 目标服务器与部署路径
│   ├── src/storage/      # RustFS（S3 path-style）与对象键
│   ├── src/deploy/       # 部署到服务器 cert 目录（deploy/）
│   └── src/overview/     # 概览与证书库列表
└── frontend/             # React 19 + Ant Design 6
```

## 环境要求

- Node.js 20 或更高版本（建议 20+ / 22+）
- npm 9 或更高版本
- 完整流程需要 Docker / Docker Compose（用于 PostgreSQL 与 RustFS）

签发服务器证书和写入证书库都需要 RustFS。创建根 CA 可以在 RustFS 暂不可用时完成（私钥和公钥 PEM 先写入数据库），随后再将公钥上传到证书库。

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

**不要把带默认密钥的服务暴露到公网。** 本地开发未给 RustFS 启用 TLS。RustFS 使用 named volume。

停止：`docker compose down` 或 `npm run infra:down`（默认保留数据卷）。

## 清空旧数据并按新产品重新配置

本次模型不兼容旧的单根 CA 与本地文件布局。用户将基于新产品重新配置。请在项目根目录执行：

```bash
npm run reset                 # 删除可能残留的 backend/data
docker compose down -v        # 删除 Postgres 与 RustFS 数据卷
docker compose up -d
npm install
npm run dev
```

也可直接运行 `./scripts/reset-product.sh`，它会清理遗留本地目录并打印清卷命令。`docker compose down` 只停容器；**加上 `-v` 才会清空数据库和文件库**。

## 2. 安装与启动应用

```bash
cd GenSSL
npm install
npm run dev
```

- 前端：http://127.0.0.1:3085 （`/api` 代理到后端）
- 后端：http://127.0.0.1:18087 （接口前缀 `/api`）

也可分开展开：`npm run dev:backend` 与 `npm run dev:frontend`。

后端连接：

- PostgreSQL：`DATABASE_URL=postgres://genssl:genssl@127.0.0.1:19666/genssl`
- RustFS：`RUSTFS_ENDPOINT=http://127.0.0.1:19701`（`forcePathStyle: true`）
- 启动时自动创建存储桶 `RUSTFS_BUCKET`（默认 `genssl`）
- 表结构：默认 `TYPEORM_SYNC=true`，启动时自动同步。生产环境可改为 `false` 并自行管理结构。

## 推荐操作步骤

1. **创建根 CA**（「根 CA」页）：填写「根证书名称」（例如 `Lan-Root-CA`）。可以创建多棵，用于轮换。下载根证书公钥给客户端安装信任。私钥只在数据库中，不会提供下载。公钥可上传到证书库 `archive/cas/<caId>/rootCA.crt`。
2. **签发服务器证书**（「签发证书」页）：必须选择一棵**启用中**的根证书，再填写一个或多个服务器 IP。SAN 将按如下格式写入并展示（全部为 IP Address 类型，不是 DNS；不要带端口）：

   ```text
   Subject Alternative Name:
       IP Address: 192.168.99.242
       IP Address: 192.168.99.243
       IP Address: 192.168.99.244
   ```

   默认为 RSA 2048、397 天、CA:FALSE、serverAuth。可选附加 DNS 名称。签发后会校验证书链、SAN、有效期以及与私钥是否匹配。服务器证书和服务器私钥写入证书库 `archive/certs/<caId>/<certId>/`，不会自动部署到服务器目录。
3. **登记目标服务器与路径**（「服务器与路径」页）：例如服务器 `web-01`，路径 `/etc/nginx/ssl` 或 `cert`。
4. **上传部署**（「上传部署」页）：选择证书、目标服务器和路径，把文件放到「服务器部署目录」`deploy/<serverName>/<path>/`。可选择同时放入该证书所属根的公钥。这与证书库不是同一处。目标路径已有同名文件时需确认覆盖。
5. 将文件从 RustFS 的服务器部署目录拷贝到真实 Nginx 服务器对应目录，并配置 `ssl_certificate` / `ssl_certificate_key`。客户端安装的必须是签发该服务器证书的那棵根的公钥。

停用某棵根后：不能再用它签发；它签过的服务器证书会显示为「已失效（需重签）」。私钥和历史都会保留，直到客户端和 Nginx 都切走。

## 数据模型（PostgreSQL）

- `root_cas`：多棵根证书（名称、主体、有效期、指纹、状态 `active|retired`、公钥 PEM、**私钥 PEM（select: false）**、证书库对象键）。
- `issued_certificates`：服务器证书（归属 `caId`、IP/DNS SAN、有效期、序列号、指纹、公钥 PEM、证书库对象键）。服务器私钥不进数据库，只在证书库。
- `servers`：目标服务器（名称、主机/IP、说明）。
- `server_paths`：某服务器上的证书部署路径文件夹。
- `deploy_records`：部署到服务器 cert 目录的记录。

## 两类 RustFS 对象键

证书库（管理档案）：

- `archive/cas/<caId>/rootCA.crt`
- `archive/certs/<caId>/<certId>/<publicFileName>.crt`
- `archive/certs/<caId>/<certId>/<keyFileName>.key`

服务器部署目录：

- `deploy/<serverName>/<normalizedPath>/<fileName>`
- 例如 `deploy/web-01/etc/nginx/ssl/192.168.99.242.crt` 或 `deploy/web-01/cert/server.crt`

任何以 `rootCA.key` 为名的对象都会被拒绝。

## 后端 API（前缀 `/api`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/overview` | 多根数量、各根下证书、两类存储状态 |
| GET/POST | `/ca` | 根证书列表 / 创建 |
| GET | `/ca/:id` | 根证书详情（不含私钥） |
| POST | `/ca/:id/retire` | 停用根证书（不删除私钥或历史） |
| POST | `/ca/:id/archive` | 将根证书公钥上传到证书库 |
| GET | `/ca/:id/download` | 下载根 CA 公钥（绝不提供私钥） |
| GET/POST | `/certs` | 证书列表 / 签发（必须带 `caId`，需 RustFS） |
| GET | `/certs/:id` | 详情与校验 |
| GET | `/certs/:id/download` | `part=bundle\|cert\|key`，不含 rootCA.key |
| GET | `/archive` | 证书库清单（与部署目录分开） |
| GET/POST | `/servers` | 服务器列表 / 创建 |
| GET/PATCH/DELETE | `/servers/:id` | 服务器详情 / 更新 / 删除 |
| POST/PATCH/DELETE | `/servers/:id/paths[/:pathId]` | 路径增改删 |
| GET/POST | `/deploys` | 部署记录 / 部署到服务器 cert 目录 |
| GET | `/servers/:serverId/paths/:pathId/files` | 列出该部署前缀下的文件 |
| GET | `/storage/objects?key=` | 从 RustFS 下载对象（仅 `archive/` 或 `deploy/`，拒绝 rootCA.key） |
| POST | `/nginx/config` | 生成 Nginx 配置示例（含应安装的根证书说明） |
| GET | `/guides/windows-trust?caId=` | 客户端安装指定根证书的指引 |

## 构建与测试

```bash
npm run build
npm test
```

后端构建产物在 `backend/dist`，前端在 `frontend/dist`。

## 已知限制

- **部署目标是 RustFS 中的「服务器部署目录」前缀**，用于集中管理待拷贝文件。当前**不会通过 SSH 直接写入远程机器磁盘**。
- 根 CA 私钥永不离开数据库，也不会进入文件服务器或下载接口。
