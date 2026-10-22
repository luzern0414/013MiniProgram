import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { fail, object, str } from '../../common/domain';
@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private auth: AuthService) {}
  @Post('auth/dev-login') login(@Body() body: unknown) { return this.auth.login(body); }
  @Post('auth/staff-login') staffLogin(@Body() body: unknown, @Req() req: any) { return this.auth.staffLogin(body, req); }
  @Post('auth/logout') logout(@Body() body: unknown, @Req() req: any) { return this.auth.logout(req, body); }
  @Get('me') me(@Req() req: any) { return this.auth.user(req); }
  @Post('auth/wechat') wechat(@Body() body: unknown) {
    const b = object(body, ['code', 'client']); str(b.code, 'code', 500);
    if (!['customer', 'merchant'].includes(b.client)) fail('VALIDATION_ERROR', 'client无效');
    fail('INTEGRATION_UNAVAILABLE', '微信身份服务尚未接入，无法登录', 503);
  }
}
