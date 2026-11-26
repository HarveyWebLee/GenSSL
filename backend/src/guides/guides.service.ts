import { Injectable } from '@nestjs/common';
import { CaService } from '../ca/ca.service';

@Injectable()
export class GuidesService {
  constructor(private readonly caService: CaService) {}

  async getWindowsTrustGuide(caId?: string) {
    const cas = await this.caService.list();
    const selected = caId ? cas.items.find((item) => item.id === caId) : cas.items.find((item) => item.status === 'active');
    const fileName = selected?.publicFileName ?? 'Lan-Root-CA.crt';
    const wasRegenerated = Boolean(selected && (selected.generation ?? 1) > 1);
    const regeneratedAt = selected?.regeneratedAt
      ? new Date(selected.regeneratedAt).toLocaleString('zh-CN', { hour12: false })
      : null;
    const steps = [
      `在「根 CA」页下载要信任的那棵根证书公钥，例如 ${fileName}。不要下载、也不存在 rootCA.key 的下载入口。`,
      '双击打开证书，选择「安装证书」。',
      '存储位置选择「本地计算机」（如有权限），或「当前用户」。',
      '选择「将所有的证书都放入下列存储」，浏览并选中「受信任的根证书颁发机构」。',
      '完成向导后，用该根签出的服务器证书所绑定的 IP 访问 HTTPS，确认浏览器不再提示不受信任。',
    ];
    if (wasRegenerated) {
      steps.push(
        `这棵根已被重新生成并覆盖（第 ${selected!.generation} 代${regeneratedAt ? `，${regeneratedAt}` : ''}）。已经安装过旧版 ${fileName} 的电脑必须改装这次下载的新公钥，否则浏览器不会信任之后新签发的服务器证书。旧的根公钥无法校验新证书。`,
      );
    } else {
      steps.push(
        '若已停用旧根并改用新根签发，或同一棵根被重新生成并覆盖，客户端都需要改装新的根公钥；旧公钥可暂时保留，直到所有机器都切走。',
      );
    }
    return {
      implemented: true,
      selectedCa: selected
        ? {
            id: selected.id,
            name: selected.name,
            status: selected.status,
            publicFileName: selected.publicFileName,
            generation: selected.generation ?? 1,
            regeneratedAt: selected.regeneratedAt,
            wasRegenerated,
          }
        : null,
      cas: cas.items.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        publicFileName: item.publicFileName,
        generation: item.generation ?? 1,
        regeneratedAt: item.regeneratedAt,
        wasRegenerated: (item.generation ?? 1) > 1,
      })),
      steps,
      warning: wasRegenerated
        ? `这棵根已被重新生成并覆盖。只安装新下载的 ${fileName}，不要继续使用旧的根公钥。不要把服务器私钥或 rootCA.key 交给客户端。`
        : '只安装根证书公钥。不要把服务器私钥或 rootCA.key 交给客户端。客户端安装的必须是签发当前网站证书的那棵根。',
    };
  }
}
