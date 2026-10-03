import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

/**
 * SSO 统一登录（模式 A）：
 *   GET /auth/sso/start    公开 → 302 到 {SSO_ISSUER}/oauth2/authorize
 *   GET /auth/sso/callback 公开 → PKCE/JWKS 校验 → upsert → 302 前端 #token=
 * 本地密码注册/登录（/auth/register、/auth/login）已移除。
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('sso/start')
  start(@Res() res: Response): void {
    res.redirect(this.auth.buildAuthorizeUrl());
  }

  @Public()
  @Get('sso/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const url = await this.auth.handleCallback({ code, state, error });
      res.redirect(url);
    } catch {
      // 统一 400，不泄露内部细节
      res.status(400).send('登录失败');
    }
  }
}
