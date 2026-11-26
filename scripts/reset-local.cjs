const { rmSync, existsSync } = require('node:fs');
const path = require('node:path');

const dataDir = path.resolve(__dirname, '../backend/data');
if (existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log('已删除遗留的本地目录 backend/data（新产品不会再把证书写到本地磁盘）。');
} else {
  console.log('没有遗留的 backend/data 目录（这是预期状态：证书材料不落本地磁盘）。');
}

console.log('');
console.log('请在项目根目录自行清空 Postgres 与 RustFS 数据卷（不要在无 Docker 的环境里启动它）：');
console.log('  docker compose down -v');
console.log('然后再执行 docker compose up -d && npm run dev');
