#!/usr/bin/env bash
# 清空本产品的旧数据，以便按「多根证书」模型重新配置。
# 不会启动 Docker，也不会连接用户机器上的 Postgres / RustFS。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -d backend/data ]; then
  rm -rf backend/data
  echo "已删除遗留的本地目录 backend/data（新产品不会再把证书写到本地磁盘）。"
else
  echo "没有遗留的 backend/data 目录（这是预期状态：证书材料不落本地磁盘）。"
fi

cat << 'TXT'

接下来请在本机项目根目录自行执行，以清空 Postgres 和 RustFS 数据卷：

  docker compose down -v

然后再启动基础设施并运行应用：

  docker compose up -d
  npm install
  npm run dev

说明：
  - docker compose down     只停止容器，保留数据卷
  - docker compose down -v  删除 Postgres 与 RustFS 的 named volume，库和对象一并清空
  - 根 CA 私钥只存在新库的 root_cas.private_key_pem 中，不会进入 RustFS
  - 证书库前缀为 archive/，服务器部署目录前缀为 deploy/

TXT
