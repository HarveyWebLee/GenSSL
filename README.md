# GenSSL

局域网 HTTPS 自建 SSL 证书管理工具。通过 Web 页面完成：创建**多棵**私有根 CA、选择根证书签发带 **IP SAN** 的服务器证书、登记目标服务器、SSH 登录方式与部署路径，将证书通过 SFTP 写入远程证书目录，并在 RustFS 中保留管理副本。

证书签发使用纯 Node.js + `node-forge`，不依赖本机 OpenSSL / WSL。Windows / Linux / macOS 均可运行。

**存储约定（无本地证书文件）：**

- **PostgreSQL**：证书元数据，以及根 CA 私钥（`rootCA.key` 只进数据库，永远不得上传、下载或写入 RustFS）。
- **RustFS 证书库（archive/）**：`rootCA.crt`、服务器证书、服务器私钥等管理档案。
- **远程服务器证书目录**：通过 SSH/SFTP 写入你登记的绝对路径（例如 `/etc/nginx/ssl`）。
- **RustFS 服务器部署目录（deploy/）**：上传时同步保存的管理副本，与证书库严格分开，不是远程写入成功的替代。
- 本产品**不会**把证书、私钥或元数据文件写到 `backend/data`、`ssl-ca` 或任何本地目录。

Nginx 需要的是服务器私钥，不要与根 CA 私钥混淆。签发和「上传部署」是独立步骤，签发或重新生成成功不会自动部署。

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
├── docker-compose.yml           # 本地基础设施：PostgreSQL + RustFS（不启动前后端）
├── docker-compose.prod.yml      # 生产编排：Postgres、RustFS、后端、前端
├── .env.example                 # 本地开发环境变量示例
├── .env.production.example      # 生产环境变量示例
├── .dockerignore
├── scripts/reset-local.cjs / reset-product.sh  # 清遗留本地目录，并提示清卷命令
├── backend/                     # NestJS
│   ├── Dockerfile               # 生产镜像（构建上下文为仓库根目录）
│   ├── src/ca/                  # 多根 CA（私钥仅存数据库）
│   ├── src/certs/               # 服务器证书签发 / 校验 / 下载
│   ├── src/archive/             # 证书库（archive/）
│   ├── src/servers/             # 目标服务器、SSH 配置与部署路径
│   ├── src/ssh/                 # SSH/SFTP 客户端、凭据加密与路径校验
│   ├── src/storage/             # RustFS（S3 path-style）与对象键
│   ├── src/deploy/              # 远程 SFTP 部署与管理副本记录
│   └── src/overview/            # 概览与证书库列表
└── frontend/                    # React 19 + Ant Design 6
    ├── Dockerfile               # 生产镜像（构建上下文为仓库根目录）
    └── nginx.conf               # 生产环境管理界面 Nginx 配置
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

后端连接（与根目录 `.env.example` / `backend/.env.example` 使用同一套键名）：

- PostgreSQL：`POSTGRES_HOST=127.0.0.1`、`POSTGRES_PORT=19666`、`POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`（示例默认均为 `genssl`）。这些键与 docker compose 中的库名、用户和密码一致。`POSTGRES_PORT` 是后端连接的主机映射端口，不要把它传给 postgres 容器当作服务端口（容器内仍是 5432，映射仍是 `19666:5432`）。仍兼容 `DATABASE_URL`；若与 `POSTGRES_*` 同时存在，以 `POSTGRES_*` 为准。
- RustFS：`RUSTFS_ENDPOINT=http://127.0.0.1:19701`（`forcePathStyle: true`），以及 `RUSTFS_REGION`、`RUSTFS_BUCKET`、`RUSTFS_ACCESS_KEY`、`RUSTFS_SECRET_KEY`
- 启动时自动创建存储桶 `RUSTFS_BUCKET`（默认 `genssl`）
- 表结构：默认 `TYPEORM_SYNC=true`，启动时自动同步。生产环境可改为 `false` 并自行管理结构。
- SSH 凭据加密：`GENSSL_SSH_CREDENTIAL_KEY`（推荐 64 位十六进制）。示例文件写出了开发用示例值，生产必须换成自己的密钥。本地开发未设置时仍可使用内置开发默认值；生产环境或 `GENSSL_STRICT_SECRETS=true` 时必须配置，否则测试连接和上传部署会失败。

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
3. **登记目标服务器与路径**（「服务器与路径」页）：例如服务器 `web-01`，填写 SSH 主机、端口（默认 22）、用户名，以及密码或私钥；部署目录为远程绝对路径，例如 `/etc/nginx/ssl`。保存后可使用「测试连接」检查登录和目录是否可访问（不会创建目录，也不会上传证书）。
4. **上传部署**（「上传部署」页）：选择证书、目标服务器和路径，平台通过 SFTP 把服务器证书和私钥（可选再带根证书公钥）写入远程目录，文件名沿用证书自己的公钥/私钥文件名。同时在 RustFS `deploy/<serverName>/<path>/` 保留一份管理副本。这与证书库不是同一处。远程目录或管理副本已有同名文件时需确认覆盖。未配置 SSH 或连接/上传失败时，接口会明确失败，不会仅因管理副本写入成功而报成功。
5. 在「Nginx 配置」页生成配置示例：`ssl_certificate` / `ssl_certificate_key` 须指向远程目录中实际上传后的文件（文件名沿用证书自己的名称，例如 `/etc/nginx/ssl/192.168.99.242.crt`），不要指向 RustFS 管理副本。`server_name` 可直接写 IP，须与证书 SAN 一致且不要带端口。非 443 端口请用 `https://IP:端口` 访问。客户端安装的必须是签发该服务器证书的那棵根的公钥。

停用某棵根后：不能再用它签发；它签过的服务器证书会显示为「已失效（需重签）」。私钥和历史都会保留，直到客户端和 Nginx 都切走。

同一棵根「重新生成并覆盖」后：仍保持启用（同一 `caId`，generation 递增），但密钥和证书会更换。已经安装过旧公钥的客户端必须改装新的根公钥，否则浏览器不会信任新签发的服务器证书。该根下旧的服务器证书会显示为「不可用，需重新生成并覆盖」，不能再部署；重新生成只更新证书库，远程目录和管理副本中的旧文件会标为已过时，需要重新上传并覆盖（包括覆盖远程服务器上的同名文件）。这与「停用根」不是同一操作。

## 数据模型（PostgreSQL）

- `root_cas`：多棵根证书（名称、主体、有效期、指纹、状态 `active|retired`、`generation` / `regeneratedAt`、公钥 PEM、**私钥 PEM（select: false）**、证书库对象键）。
- `issued_certificates`：服务器证书（归属 `caId`、签发时的 `caGeneration` / 根指纹、IP/DNS SAN、有效期、序列号、指纹、公钥 PEM、证书库对象键）。服务器私钥不进数据库，只在证书库。
- `servers`：目标服务器（名称、主机/IP、说明、SSH 端口/用户名/认证方式、加密后的密码或私钥、是否已保存凭据、连接超时、已锁定的主机密钥指纹）。密码、私钥和私钥口令使用 AES-256-GCM 加密存放，列属性为 `select: false`，列表/详情/部署接口只返回 `hasPassword` / `hasPrivateKey` 等布尔值，不会回传明文或密文。
- `server_paths`：某服务器上的远程证书部署目录（绝对路径）。
- `deploy_records`：上传部署记录（证书指纹、远程主机与路径、成功/失败、是否已同步管理副本）。

## 两类 RustFS 对象键

证书库（管理档案）：

- `archive/cas/<caId>/rootCA.crt`
- `archive/certs/<caId>/<certId>/<publicFileName>.crt`
- `archive/certs/<caId>/<certId>/<keyFileName>.key`

服务器部署目录（管理副本，与远程写入分开）：

- `deploy/<serverName>/<normalizedPath>/<fileName>`
- 例如 `deploy/web-01/etc/nginx/ssl/192.168.99.242.crt`

任何以 `rootCA.key` 为名的对象都会被拒绝。

## 后端 API（前缀 `/api`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/overview` | 多根数量、各根下证书、两类存储状态 |
| GET/POST | `/ca` | 根证书列表 / 创建 |
| GET | `/ca/:id` | 根证书详情（不含私钥） |
| POST | `/ca/:id/retire` | 停用根证书（不删除私钥或历史） |
| POST | `/ca/:id/regenerate` | 重新生成并覆盖同一棵根（保持启用） |
| POST | `/ca/:id/archive` | 将根证书公钥上传到证书库 |
| GET | `/ca/:id/download` | 下载根 CA 公钥（绝不提供私钥） |
| GET/POST | `/certs` | 证书列表 / 签发（必须带 `caId`，需 RustFS） |
| GET | `/certs/:id` | 详情与校验 |
| GET | `/certs/:id/download` | `part=bundle\|cert\|key`，不含 rootCA.key |
| POST | `/certs/:id/regenerate` | 重新生成并覆盖一张服务器证书（不改 deploy/） |
| POST | `/certs/regenerate-batch` | 批量重新生成并覆盖 |
| GET | `/archive` | 证书库清单（与部署目录分开） |
| GET/POST | `/servers` | 服务器列表 / 创建（含 SSH 配置；响应不含凭据明文） |
| GET/PATCH/DELETE | `/servers/:id` | 服务器详情 / 更新 / 删除。更新时留空密码或私钥表示保持原凭据，可用 `clearSshCredentials` 清除 |
| POST | `/servers/test-connection` 与 `/servers/:id/test-connection` | 测试 SSH 登录，可选检查远程目录。不上传证书 |
| POST/PATCH/DELETE | `/servers/:id/paths[/:pathId]` | 路径增改删 |
| GET/POST | `/deploys` | 部署记录 / 通过 SFTP 上传到远程证书目录（并写管理副本） |
| GET | `/servers/:serverId/paths/:pathId/files` | 列出远程目录和管理副本中的文件 |
| GET | `/storage/objects?key=` | 从 RustFS 下载对象（仅 `archive/` 或 `deploy/`，拒绝 rootCA.key） |
| POST | `/nginx/config` | 生成 Nginx 配置示例（含应安装的根证书说明） |
| GET | `/guides/windows-trust?caId=` | 客户端安装指定根证书的指引 |

## 构建与测试

```bash
npm run build
npm test
```

后端构建产物在 `backend/dist`，前端在 `frontend/dist`。

## 3. 生产环境 Docker 部署

生产编排与本机开发是两套配置，不要把开发端口改成生产端口。

| 环境 | 前端 | 后端 | PostgreSQL | RustFS S3 |
| --- | --- | --- | --- | --- |
| 本机开发 | http://127.0.0.1:3085 | http://127.0.0.1:18087/api | 127.0.0.1:19666 | http://127.0.0.1:19701 |
| 生产 Docker | `http://<主机>:18347` | `http://<主机>:19347/api` | 仅容器网络 `postgres:5432` | 仅容器网络 `http://rustfs:9000` |

`docker compose up -d` 和 `npm run infra:up` **只**启动本地 Postgres 与 RustFS，不会拉起前后端。生产栈请使用下面的命令。

1. 复制并编辑生产环境变量（不要提交真实的 `.env.production`，也不要把它打进镜像）：

```bash
cp .env.production.example .env.production
```

必须自行更换 `POSTGRES_PASSWORD`、`RUSTFS_ACCESS_KEY`、`RUSTFS_SECRET_KEY`、`GENSSL_SSH_CREDENTIAL_KEY`。生产示例中 `GENSSL_STRICT_SECRETS=true`，未配置 SSH 加密密钥时测试连接和上传部署会失败。可用 `openssl rand -hex 32` 生成 64 位十六进制密钥。

生产环境变量键名与开发一致。容器内后端连接数据库应使用 `POSTGRES_HOST=postgres`、`POSTGRES_PORT=5432`（不要用 19666）；RustFS 使用 `RUSTFS_ENDPOINT=http://rustfs:9000`（不要用 19701）。这些容器网络地址已在 `docker-compose.prod.yml` 中为后端写明，避免误用宿主机开发地址。

数据目录默认绑定到项目下的相对路径，可在 `.env.production` 中修改：

| 变量 | 默认值 | 容器内挂载点 |
| --- | --- | --- |
| `POSTGRES_DATA_PATH` | `./data/prod/postgres` | `/var/lib/postgresql/data` |
| `RUSTFS_DATA_PATH` | `./data/prod/rustfs` | 父目录下的 `0`–`3` 分别对应 `/data/rustfs0`–`3` |
| `RUSTFS_LOGS_PATH` | `./data/prod/rustfs-logs` | `/app/logs` |

相对路径相对于 `docker-compose.prod.yml`（即项目根目录）。也可以改成绝对路径；在 Windows 上请使用正斜杠，例如：

```env
POSTGRES_DATA_PATH=D:/genssl-data/postgres
RUSTFS_DATA_PATH=D:/genssl-data/rustfs
RUSTFS_LOGS_PATH=D:/genssl-data/rustfs-logs
```

不要把这些变量留空。编排文件使用 `${VAR:-默认值}`，未设置或为空时会回退到上面的项目相对路径，而不会把 `${RUSTFS_DATA_PATH}/0` 解析成 `/0` 误挂到宿主机根目录。

如果之前已经用 Docker 命名卷跑过生产栈，改成绑定挂载后**不会自动迁移旧数据**，新的宿主机目录一开始是空的。旧数据仍留在原先的命名卷中（可用 `docker volume ls` 查看，项目名为 `genssl-prod`），需要的话请自行备份或迁移后再切换。切换后 `npm run prod:down` 只会停止容器，数据保留在你配置的宿主机目录里。

在 Windows（Docker Desktop）上把路径绑到 NTFS 目录时，权限和所有者表现可能和 Linux 宿主机不一样。生产编排仍会运行 RustFS 的 permission helper（`chown 10001`）；若 RustFS 因权限无法写入，可改把数据目录放到 Linux 文件系统或 WSL 发行版路径下再试。

2. 构建并启动：

如果已安装 Docker Compose 插件（`docker compose version` 能显示 Compose 版本）：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

如果提示 `'compose' is not a docker command`，但已安装独立的 Compose V2（`docker-compose version` 显示 `Docker Compose version v2.x`），请改用：

```bash
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

这两条命令等价，生产编排需要 Compose V2。也可以执行 `npm run prod:up`（同样读取 `.env.production`）；该脚本调用的是 `docker compose`，在只有独立 `docker-compose` 的机器上请直接使用上面带连字符的命令。查看状态：`npm run prod:ps`。停止：`npm run prod:down`（默认保留你配置的宿主机数据目录）。对应的独立命令是：

```bash
docker-compose -f docker-compose.prod.yml --env-file .env.production ps
docker-compose -f docker-compose.prod.yml --env-file .env.production down
```

3. 访问：

- 管理界面：`http://<主机>:18347`（Nginx 托管前端静态资源，并将 `/api` 反代到后端）
- 后端直连：`http://<主机>:19347/api`
- 前端 axios 的 `baseURL` 仍是相对路径 `/api`，不要改成绝对地址

生产环境 Postgres 与 RustFS 默认不对宿主机暴露端口。如需查看 RustFS 控制台，可在 `docker-compose.prod.yml` 中按注释打开端口映射。

后端容器需要 SSH 到局域网服务器（例如 `192.168.99.242:22`）时，使用默认 bridge 即可：只要宿主机能路由到这些地址，容器一般也能访问。

前端 Nginx 配置在 `frontend/nginx.conf`，镜像内监听 18347。管理界面本次先使用 HTTP；日后可用本平台签发的证书为该站点加 TLS。这与「Nginx 配置」页生成的**业务站点**证书示例不是同一份配置。

## SSH 与主机密钥

- 远程部署使用 Node.js `ssh2` 客户端，通过 SFTP 写入远程绝对目录。主要面向 Linux OpenSSH，也兼容 Windows OpenSSH（路径请使用 `C:/nginx/ssl` 这样的绝对路径）。平台**不会**自动创建远程目录；目录不存在时会明确失败。
- **首次成功的测试连接或上传部署**会记录并锁定该主机的 SSH 主机密钥指纹（Trust On First Use）。之后连接会校验同一指纹。若主机密钥变化，操作会失败并提示你在服务器设置中「重新信任主机密钥」。更改主机或端口会清除已锁定的指纹。生产代码不会静默关闭主机密钥校验。
- SSH 密码、私钥和私钥口令使用 `GENSSL_SSH_CREDENTIAL_KEY` 做 AES-256-GCM 加密后存入 PostgreSQL，不会写入 RustFS、本地磁盘、日志或前端回显。
- 根 CA 私钥永不离开数据库，也不会进入文件服务器、远程服务器或下载接口。

## 已知限制

- 上传部署需要目标机器运行 SSH/SFTP，并且该账号对证书目录有写权限。测试连接不会创建缺失的目录。
- 文件服务器中的 `deploy/` 前缀只是管理副本。远程写入失败时，接口不会因为管理副本已写入而报告成功。
