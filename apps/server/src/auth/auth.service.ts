import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Inject } from '@nestjs/common';
import {
  PublicUser,
  toPublicUser,
  USER_STORE,
  UserStore,
} from '../storage/stores';
import { BCRYPT_ROUNDS } from './auth.constants';
import { LoginDto, RegisterDto } from './dto/auth.dto';

export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_STORE) private readonly users: UserStore,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.users.findByUsername(dto.username);
    if (existing) {
      throw new ConflictException('用户名已存在');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.users.create({
      username: dto.username,
      passwordHash,
      avatarId: dto.avatarId ?? 1,
    });
    return this.sign(user.id, user.username, toPublicUser(user));
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.users.findByUsername(dto.username);
    const ok = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : false;
    if (!user || !ok) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    return this.sign(user.id, user.username, toPublicUser(user));
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    return toPublicUser(user);
  }

  private sign(id: string, username: string, user: PublicUser): AuthResponse {
    return {
      accessToken: this.jwt.sign({ sub: id, username }),
      user,
    };
  }
}
