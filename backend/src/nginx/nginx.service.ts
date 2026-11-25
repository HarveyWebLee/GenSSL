import { Injectable } from '@nestjs/common';
import { GenerateNginxDto } from './dto/generate-nginx.dto';

@Injectable()
export class NginxService {
  generate(_dto: GenerateNginxDto) {
    return {
      implemented: false,
      message: 'Nginx 配置生成功能待实现',
    };
  }
}
