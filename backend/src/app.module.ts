import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import path from 'node:path';
import { postgresConnectionFromConfig } from './config/database.config';
import { CaModule } from './ca/ca.module';
import { CertsModule } from './certs/certs.module';
import { DeployModule } from './deploy/deploy.module';
import { GuidesModule } from './guides/guides.module';
import { HealthController } from './health/health.controller';
import { NginxModule } from './nginx/nginx.module';
import { OverviewModule } from './overview/overview.module';
import { ServersModule } from './servers/servers.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '../.env'),
      ],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const postgres = postgresConnectionFromConfig(config);
        return {
          type: 'postgres' as const,
          host: postgres.host,
          port: postgres.port,
          username: postgres.username,
          password: postgres.password,
          database: postgres.database,
          autoLoadEntities: true,
          synchronize: config.get<string>('TYPEORM_SYNC', 'true') !== 'false',
          logging: config.get<string>('TYPEORM_LOGGING') === 'true',
          retryAttempts: 10,
          retryDelay: 3000,
        };
      },
    }),
    CaModule,
    CertsModule,
    ServersModule,
    StorageModule,
    DeployModule,
    OverviewModule,
    NginxModule,
    GuidesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
