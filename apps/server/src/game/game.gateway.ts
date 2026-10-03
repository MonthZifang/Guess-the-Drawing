import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import type { Namespace, Socket } from 'socket.io';
import { GameService } from './game.service';

interface HandshakeUser {
  sub: string;
  username: string;
  avatarId?: number;
  publicId?: number | null;
}

/**
 * /game 空间：握手带 JWT（auth.token 或 Authorization 头），无效则拒绝连接；
 * 事件语义见 docs/compose/spec/guess-draw-anime.md [S2] Socket.IO 事件表。
 */
@WebSocketGateway({ namespace: '/game', cors: { origin: '*' } })
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly game: GameService,
  ) {}

  afterInit(server: Namespace): void {
    this.game.attach(server);
    // 握手中间件：JWT 校验失败 → 连接拒绝（connect_error）
    if (typeof (server as unknown as { use?: unknown }).use === 'function') {
      server.use((socket: Socket, next: (err?: Error) => void) => {
        this.verifyHandshake(socket)
          .then((user) => {
            socket.data.user = user;
            next();
          })
          .catch(() => next(new Error('unauthorized')));
      });
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    if (!client.data?.user) {
      try {
        client.data.user = await this.verifyHandshake(client);
      } catch {
        this.logger.warn(`拒绝未授权连接: ${client.id}`);
        client.emit('error', { message: '未授权：JWT 无效或缺失' });
        client.disconnect(true);
      }
    }
  }

  handleDisconnect(client: Socket): void {
    this.game.handleDisconnect(client);
  }

  @SubscribeMessage('room:join')
  onRoomJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): void {
    void this.game.handleJoin(socket, body);
  }

  @SubscribeMessage('room:leave')
  onRoomLeave(@ConnectedSocket() socket: Socket): void {
    this.game.handleLeave(socket);
  }

  @SubscribeMessage('game:start')
  onGameStart(@ConnectedSocket() socket: Socket): void {
    this.game.handleStart(socket);
  }

  @SubscribeMessage('stroke')
  onStroke(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): void {
    this.game.handleStroke(socket, body);
  }

  @SubscribeMessage('guess')
  onGuess(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): void {
    this.game.handleGuess(socket, body);
  }

  @SubscribeMessage('chat')
  onChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): void {
    this.game.handleChat(socket, body);
  }

  @SubscribeMessage('tool:clear')
  onToolClear(@ConnectedSocket() socket: Socket): void {
    this.game.handleClear(socket);
  }

  @SubscribeMessage('vote:cast')
  onVoteCast(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): void {
    this.game.handleVote(socket, body);
  }

  private async verifyHandshake(client: Socket): Promise<HandshakeUser> {
    const auth = (client.handshake.auth ?? {}) as Record<string, unknown>;
    let token =
      typeof auth.token === 'string' ? auth.token.trim() : '';
    if (!token) {
      const header = client.handshake.headers.authorization;
      if (typeof header === 'string' && header.startsWith('Bearer ')) {
        token = header.slice(7).trim();
      }
    }
    if (!token) {
      throw new Error('missing token');
    }
    const payload = await this.jwt.verifyAsync<{
      sub: string;
      username: string;
      avatarId?: number;
      publicId?: number | null;
    }>(token);
    if (!payload?.sub) {
      throw new Error('invalid payload');
    }
    return {
      sub: payload.sub,
      username: payload.username,
      avatarId: payload.avatarId,
      publicId: payload.publicId ?? null,
    };
  }
}
