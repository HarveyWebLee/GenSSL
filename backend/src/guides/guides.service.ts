import { Injectable } from '@nestjs/common';

@Injectable()
export class GuidesService {
  getWindowsTrustGuide() {
    return {
      implemented: false,
      message: 'Windows 客户端根 CA 安装说明待实现',
    };
  }
}
