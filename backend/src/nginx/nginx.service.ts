import { Injectable } from '@nestjs/common';
import { CaService } from '../ca/ca.service';
import { GenerateNginxDto } from './dto/generate-nginx.dto';

@Injectable()
export class NginxService {
  constructor(private readonly caService: CaService) {}

  async generate(dto: GenerateNginxDto) {
    const listenPort = dto.listenPort ?? 443;
    const cert = dto.sslCertificate?.trim() || '/etc/nginx/ssl/server.crt';
    const key = dto.sslCertificateKey?.trim() || '/etc/nginx/ssl/server.key';
    const serverName = dto.serverName?.trim() || '_';
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

    const extra: string[] = [];
    if (dto.rootPath?.trim()) {
      extra.push(`    root ${dto.rootPath.trim()};`, '    index index.html;');
    }
    if (dto.proxyPass?.trim()) {
      extra.push(
        '    location / {',
        `        proxy_pass ${dto.proxyPass.trim()};`,
        '        proxy_set_header Host $host;',
        '        proxy_set_header X-Real-IP $remote_addr;',
        '    }',
      );
    }

    const config = [
      '# 请先把证书和私钥从 RustFS「服务器部署目录」拷到这台机器的 cert 目录（或你登记的部署路径）。',
      '# 访问网站的电脑需要安装「签发这张服务器证书的那棵根」的公钥，不要装其他根，更不要分发 rootCA.key。',
      '# 当前可安装的根证书：',
      caComments,
      '',
      'server {',
      `    listen ${listenPort} ssl;`,
      `    listen [::]:${listenPort} ssl;`,
      `    server_name ${serverName};`,
      '',
      `    ssl_certificate     ${cert};`,
      `    ssl_certificate_key ${key};`,
      '',
      '    ssl_protocols TLSv1.2 TLSv1.3;',
      '    ssl_prefer_server_ciphers off;',
      ...(extra.length ? ['', ...extra] : []),
      '}',
      '',
    ].join('\n');

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
        (cas.items.some((item) => item.status === 'active' && (item.generation ?? 1) > 1)
          ? '若根证书已被重新生成并覆盖，客户端必须安装新的根公钥，且 Nginx 上应使用重新生成并重新上传后的服务器证书。'
          : '') +
        '文件名不必叫 server.crt / server.key，只要 ssl_certificate 与 ssl_certificate_key 指向实际文件即可。',
    };
  }
}
