import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CaService } from '../ca/ca.service';
import { NginxService } from './nginx.service';

const SSL_CIPHERS =
  'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';

function createService(
  items: Array<{
    id: string;
    name: string;
    status: 'active' | 'retired';
    publicFileName: string;
    generation?: number;
    regeneratedAt?: Date | null;
  }> = [],
) {
  const caService = {
    list: async () => ({ items, activeCount: items.filter((item) => item.status === 'active').length, retiredCount: 0 }),
  } as unknown as CaService;
  return new NginxService(caService);
}

describe('NginxService', () => {
  it('generates a default HTTPS example with the confirmed ciphers, session settings and HSTS', async () => {
    const service = createService();
    const result = await service.generate({});

    assert.equal(result.implemented, true);
    assert.match(result.config, /listen 443 ssl;/);
    assert.match(result.config, /# listen \[::\]:443 ssl;/);
    assert.match(result.config, /server_name 192\.168\.99\.242;/);
    assert.match(result.config, /ssl_certificate\s+\/etc\/nginx\/ssl\/192\.168\.99\.242\.crt;/);
    assert.match(result.config, /ssl_certificate_key\s+\/etc\/nginx\/ssl\/192\.168\.99\.242\.key;/);
    assert.match(result.config, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
    assert.match(result.config, new RegExp(`ssl_ciphers\\s+${SSL_CIPHERS.replace(/-/g, '\\-')};`));
    assert.match(result.config, /ssl_prefer_server_ciphers off;/);
    assert.match(result.config, /ssl_session_cache\s+shared:SSL:10m;/);
    assert.match(result.config, /ssl_session_timeout 1d;/);
    assert.match(result.config, /ssl_session_tickets off;/);
    assert.match(result.config, /add_header Strict-Transport-Security "max-age=31536000" always;/);
    assert.equal(/add_header Strict-Transport-Security "[^"]*includeSubDomains/.test(result.config), false);
    assert.match(result.config, /location \/ \{/);
    assert.match(result.config, /root\s+html;/);
    assert.match(result.config, /index index\.html;/);
    assert.equal(/^\s*listen \[::\]:/m.test(result.config), false);
    assert.match(result.config, /已通过 SFTP/);
    assert.match(result.config, /不要指向 RustFS「服务器部署目录」里的管理副本路径/);
    assert.equal(result.config.includes('从 RustFS'), false);
    assert.equal(/拷到/.test(result.config), false);
    assert.equal((result.note ?? '').includes('从 RustFS 拷'), false);
    assert.match(result.note ?? '', /SFTP/);
    assert.match(result.note ?? '', /不要指向 RustFS 管理副本/);
  });

  it('puts custom port, IP and uploaded file names into the example', async () => {
    const service = createService();
    const result = await service.generate({
      listenPort: 3084,
      serverName: '10.0.0.8',
      sslCertificate: '/data/smartsecurity/nginx/cert/10.0.0.8.crt',
      sslCertificateKey: '/data/smartsecurity/nginx/cert/10.0.0.8.key',
      rootPath: '/var/www/html',
    });

    assert.match(result.config, /listen 3084 ssl;/);
    assert.match(result.config, /# listen \[::\]:3084 ssl;/);
    assert.match(result.config, /server_name 10\.0\.0\.8;/);
    assert.match(result.config, /ssl_certificate\s+\/data\/smartsecurity\/nginx\/cert\/10\.0\.0\.8\.crt;/);
    assert.match(result.config, /ssl_certificate_key\s+\/data\/smartsecurity\/nginx\/cert\/10\.0\.0\.8\.key;/);
    assert.match(result.config, /root\s+\/var\/www\/html;/);
    assert.match(result.config, /https:\/\/10\.0\.0\.8:3084/);
    assert.equal(result.config.includes('listen 443 ssl;'), false);
    assert.equal(result.config.includes('/etc/nginx/ssl/server.crt'), false);
  });

  it('prefers a reverse-proxy location over the static site block', async () => {
    const service = createService();
    const result = await service.generate({
      rootPath: '/var/www/html',
      proxyPass: 'http://127.0.0.1:8080',
    });

    assert.match(result.config, /proxy_pass http:\/\/127\.0\.0\.1:8080;/);
    assert.match(result.config, /不要同时写两个 location \//);
    assert.equal(result.config.includes('root  /var/www/html;'), false);
    assert.equal(result.config.includes('root  html;'), false);
    assert.equal((result.config.match(/location \/ \{/g) ?? []).length, 1);
  });

  it('lists installable root certificates and warns after a regeneration', async () => {
    const service = createService([
      {
        id: 'ca-1',
        name: 'Lan-Root-CA',
        status: 'active',
        publicFileName: 'Lan-Root-CA.crt',
        generation: 2,
        regeneratedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const result = await service.generate({});

    assert.match(result.config, /Lan-Root-CA（下载 Lan-Root-CA\.crt，状态：启用中，已重新生成并覆盖，客户端须改装新公钥）/);
    assert.match(result.note ?? '', /若根证书已被重新生成并覆盖/);
    assert.equal(result.cas?.length, 1);
    assert.equal(result.cas?.[0]?.generation, 2);
  });
});
