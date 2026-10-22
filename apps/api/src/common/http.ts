import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { map } from 'rxjs';
import { DomainError } from './domain';
@Injectable()
export class Envelope implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    req.requestId = randomUUID();
    return next.handle().pipe(map(data => ({data, requestId: req.requestId})));
  }
}
@Catch()
export class Errors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const status = error instanceof DomainError ? error.status : error instanceof HttpException ? error.getStatus() : 500;
    const requestId = ctx.getRequest().requestId || randomUUID();
    // Prisma messages can embed query arguments including credential hashes.
    if (status === 500) console.error('API error', {requestId, type: error.constructor?.name || 'Error', code: /^P\d{4}$/.test(error.code) ? error.code : undefined});
    ctx.getResponse().status(status).json({error: {code: error instanceof DomainError ? error.code : status === 404 ? 'NOT_FOUND' : status === 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR', message: error instanceof DomainError ? error.message : status === 500 ? '服务暂时不可用' : '请求无效'}, requestId});
  }
}
