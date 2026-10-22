import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertEnvironment } from './common/domain';
import { Envelope, Errors } from './common/http';
export async function createApp() {
  assertEnvironment(process.env);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; production never uses a development fallback');
  const app = await NestFactory.create(AppModule, {logger: ['error', 'warn']});
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new Envelope()); app.useGlobalFilters(new Errors());
  app.enableCors({origin: process.env.NODE_ENV === 'production' ? (process.env.CORS_ORIGINS || '').split(',').filter(Boolean) : true, allowedHeaders: ['Content-Type','Authorization','Idempotency-Key','X-Request-Id'], methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS']});
  app.enableShutdownHooks(); return app;
}
if (require.main === module) createApp().then(app => app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1')).catch(error => { console.error(error.message); process.exitCode = 1; });
