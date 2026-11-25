import { Injectable } from '@nestjs/common';
import { IssueCertDto } from './dto/issue-cert.dto';

@Injectable()
export class CertsService {
  list() {
    return {
      implemented: false,
      items: [] as unknown[],
      message: '证书列表功能待实现',
    };
  }

  issue(_dto: IssueCertDto) {
    return {
      implemented: false,
      message: '服务器证书签发功能待实现',
    };
  }

  getDetail(name: string) {
    return {
      implemented: false,
      name,
      message: '证书详情与验证功能待实现',
    };
  }

  prepareDownload(name: string) {
    return {
      implemented: false,
      name,
      message: '证书包下载功能待实现',
    };
  }
}
