import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      ok: true,
      service: 'GenSSL',
      message: '后端服务运行中',
    };
  }
}
