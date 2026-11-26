import { Injectable } from '@nestjs/common';
import { CaService } from '../ca/ca.service';

@Injectable()
export class GuidesService {
  constructor(private readonly caService: CaService) {}

  async getWindowsTrustGuide(caId?: string) {
    const cas = await this.caService.list();
    const selected = caId ? cas.items.find((item) => item.id === caId) : cas.items.find((item) => item.status === 'active');
    const fileName = selected?.publicFileName ?? 'Lan-Root-CA.crt';
    return {
      implemented: true,
      selectedCa: selected
        ? { id: selected.id, name: selected.name, status: selected.status, publicFileName: selected.publicFileName }
        : null,
      cas: cas.items.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        publicFileName: item.publicFileName,
      })),
      steps: [
        `在「根 CA」页下载要信任的那棵根证书公钥，例如 ${fileName}。不要下载、也不存在 rootCA.key 的下载入口。`,
        '双击打开证书，选择「安装证书」。',
        '存储位置选择「本地计算机」（如有权限），或「当前用户」。',
        '选择「将所有的证书都放入下列存储」，浏览并选中「受信任的根证书颁发机构」。',
        '完成向导后，用该根签出的服务器证书所绑定的 IP 访问 HTTPS，确认浏览器不再提示不受信任。',
        '若已停用旧根并改用新根签发，客户端需要改装新根的公钥；旧根可暂时保留，直到所有机器都切走。',
      ],
      warning: '只安装根证书公钥。不要把服务器私钥或 rootCA.key 交给客户端。客户端安装的必须是签发当前网站证书的那棵根。',
    };
  }
}
