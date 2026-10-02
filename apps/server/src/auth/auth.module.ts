import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JWT_EXPIRES_IN, JWT_SECRET } from './auth.constants';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersController } from './users.controller';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: { expiresIn: JWT_EXPIRES_IN },
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    // 全局 JWT 守卫：除 @Public()（register/login/health）外均需 Bearer token
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
