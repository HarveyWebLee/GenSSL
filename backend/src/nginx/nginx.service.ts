import { Injectable } from '@nestjs/common';
import { CaService } from '../ca/ca.service';
import { GenerateNginxDto } from './dto/generate-nginx.dto';

const DEFAULT_LISTEN_PORT = 443;
const DEFAULT_SERVER_NAME = '192.168.99.242';
const DEFAULT_CERT_DIR = '/etc/nginx/ssl';
const DEFAULT_CERT_FILE = '192.168.99.242.crt';
const DEFAULT_KEY_FILE = '192.168.99.242.key';
const DEFAULT_ROOT_PATH = 'html';
const SSL_CIPHERS =
  'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';

@Injectable()
export class NginxService {
  constructor(private readonly caService: CaService) {}

  async generate(dto: GenerateNginxDto) {
    const listenPort = dto.listenPort ?? DEFAULT_LISTEN_PORT;
    const cert = dto.sslCertificate?.trim() || `${DEFAULT_CERT_DIR}/${DEFAULT_CERT_FILE}`;
    const key = dto.sslCertificateKey?.trim() || `${DEFAULT_CERT_DIR}/${DEFAULT_KEY_FILE}`;
    const serverName = dto.serverName?.trim() || DEFAULT_SERVER_NAME;
    const rootPath = dto.rootPath?.trim() || DEFAULT_ROOT_PATH;
    const proxyPass = dto.proxyPass?.trim();
    const cas = await this.caService.list();
    const preferred = cas.items.filter((item) => item.status === 'active');
    const listed = preferred.length ? preferred : cas.items;
    const caComments = listed.length
      ? listed
          .map((item) => {
            const status = item.status === 'active' ? '启用中' : '已停用';
            const regen =
              (item.generation ?? 1) > 1
                ? '，已重新生成并覆盖，客户端须改装新公钥'
                : '';
            return `#   - ${item.name}（下载 ${item.publicFileName}，状态：${status}${regen}）`;
          })
          .join('\n')
      : '#   （尚未创建根证书）';

    const accessComment =
      listenPort === DEFAULT_LISTEN_PORT
        ? `# 监听端口默认为 443，也可以改成 3084 这类端口。非 443 时请用 https://IP:端口 访问，例如 https://${serverName}:3084。证书 SAN 不要写端口。`
        : `# 当前监听端口不是 443，请用 https://IP:端口 访问，例如 https://${serverName}:${listenPort}。证书 SAN 不要写端口。`;

    const locationBlock = proxyPass
      ? [
          '    # 本示例按反向代理写出；静态站点的 root / index 已省略，不要同时写两个 location /。',
          '    location / {',
          `        proxy_pass ${proxyPass};`,
          '        proxy_set_header Host $host;',
          '        proxy_set_header X-Real-IP $remote_addr;',
          '    }',
        ]
      : [
          '    location / {',
          `        root  ${rootPath};    # 网站根目录；相对路径相对于 Nginx 安装目录（prefix）`,
          '        index index.html;',
          '    }',
        ];

    const config = [
      '# 「上传部署」已通过 SFTP 把证书和私钥写到这台机器上登记的绝对目录。',
      '# 请把下面的 ssl_certificate / ssl_certificate_key 改成该目录中的实际文件名。',
      '# 不要指向 RustFS「服务器部署目录」里的管理副本路径。',
      '# 若写成相对路径（例如 cert/server.crt），则相对于 Nginx 的安装目录（prefix）。',
      '# 访问网站的电脑需要安装「签发这张服务器证书的那棵根」的公钥，不要装其他根，更不要分发 rootCA.key。',
      '# 当前可安装的根证书：',
      caComments,
      '',
      'server {',
      `    listen ${listenPort} ssl;`,
      `    # listen [::]:${listenPort} ssl;    # 仅在这台机器需要提供 IPv6 访问时取消注释`,
      `    server_name ${serverName};    # 可直接写 IP，须与证书 SAN 中的 IP 一致，不要带端口`,
      '',
      '    # 请使用登记的绝对目录 + 实际上传后的文件名，不必叫 server.crt / server.key',
      `    ssl_certificate     ${cert};`,
      `    ssl_certificate_key ${key};`,
      '',
      '    ssl_protocols TLSv1.2 TLSv1.3;',
      '    # 下面这组套件可直接使用。当前产品签发的是 RSA 证书，实际会用到两条 ECDHE-RSA；',
      '    # ECDHE-ECDSA 两条留给以后的 ECC 证书。ssl_ciphers 只约束 TLS 1.2，TLS 1.3 套件由 OpenSSL 默认处理。',
      `    ssl_ciphers   ${SSL_CIPHERS};`,
      '    ssl_prefer_server_ciphers off;',
      '',
      '    ssl_session_cache   shared:SSL:10m;',
      '    ssl_session_timeout 1d;',
      '    ssl_session_tickets off;',
      '',
      '    # HSTS 记住 365 天。没有域名时不要加 includeSubDomains。对纯 IP 访问，多数浏览器会忽略此头。',
      '    add_header Strict-Transport-Security "max-age=31536000" always;',
      '',
      `    ${accessComment}`,
      '',
      ...locationBlock,
      '}',
      '',
    ].join('\n');

    const regenNote = cas.items.some((item) => item.status === 'active' && (item.generation ?? 1) > 1)
      ? '若根证书已被重新生成并覆盖，客户端必须安装新的根公钥，且 Nginx 上应使用重新生成并重新上传后的服务器证书。'
      : '';

    return {
      implemented: true,
      config,
      cas: cas.items.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        publicFileName: item.publicFileName,
        generation: item.generation ?? 1,
        regeneratedAt: item.regeneratedAt,
      })),
      note:
        regenNote +
        '「上传部署」已通过 SFTP 把文件写到登记的绝对目录，请让配置指向这些实际文件，不要指向 RustFS 管理副本。文件名不必叫 server.crt / server.key，只要 ssl_certificate 与 ssl_certificate_key 指向实际文件即可。',
    };
  }
}
