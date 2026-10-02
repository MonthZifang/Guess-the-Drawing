import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from './current-user.decorator';
import { AuthService } from './auth.service';
import { PublicUser } from '../storage/stores';

@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.auth.me(user.sub);
  }
}
