import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import type { OrderRule, RoundsSpec } from '../game/rotation';
import { normalizeCode, RoomRegistry } from './room.registry';
import { DEFAULT_ROUNDS, DrawRule, Room } from './room.types';

class RoundsDto {
  @IsOptional()
  @IsIn(['byPlayers', 'fixed', 'custom'])
  mode?: RoundsSpec['mode'];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  value?: number;
}

export class CreateRoomDto {
  @IsOptional()
  @IsIn(['id', 'lapShuffle', 'roundShuffle'])
  orderRule?: OrderRule;

  @IsOptional()
  @IsIn(['classic', 'chain'])
  drawRule?: DrawRule;

  @IsOptional()
  @ValidateNested()
  @Type(() => RoundsDto)
  rounds?: RoundsDto;
}

export interface RoomSnapshot {
  code: string;
  ownerId: string;
  status: Room['status'];
  phase: Room['phase'];
  roundNo: number;
  maxPlayers: number;
  /** 画者顺序规则 */
  orderRule: OrderRule;
  /** 画板规则 */
  drawRule: DrawRule;
  /** 回合计法设置 */
  rounds: RoundsSpec;
  /** 解析后的总回合（byPlayers 开局前为 null） */
  totalRounds: number | null;
  roundSeconds: number;
  players: Array<{
    userId: string;
    username: string;
    avatarId: number;
    publicId: number | null;
    score: number;
    guessed: boolean;
  }>;
  strokes: Room['strokes'];
  drawerId: string | null;
  charCount: number | null;
  endsAt: number | null;
  /** 仅当前画者可见 */
  word?: string;
  /** 仅当前画者可见（词的类别，如 建筑/单位…） */
  category?: string;
  /** 链式态：仅当前画者可见的本段题目 */
  prompt?: string;
  promptCategory?: string;
  /** 链式态：本段指定猜词者 */
  guesserId?: string | null;
  chainIndex?: number;
  chainTotal?: number;
}

export function roomSnapshot(room: Room, requesterId?: string): RoomSnapshot {
  const isDrawer =
    !!requesterId && !!room.prompt && room.drawerId === requesterId;
  const snap: RoomSnapshot = {
    code: room.code,
    ownerId: room.ownerId,
    status: room.status,
    phase: room.phase,
    roundNo: room.roundNo,
    maxPlayers: room.maxPlayers,
    orderRule: room.orderRule,
    drawRule: room.drawRule,
    rounds: { ...room.roundsSpec },
    totalRounds: room.totalRounds,
    roundSeconds: room.roundSeconds,
    players: room.players.map((p) => ({
      userId: p.userId,
      username: p.username,
      avatarId: p.avatarId,
      publicId: p.publicId,
      score: p.score,
      guessed: p.guessed,
    })),
    strokes: room.strokes,
    drawerId: room.drawerId,
    charCount: room.prompt ? room.prompt.text.length : null,
    endsAt: room.endsAt,
  };
  if (isDrawer && room.prompt) {
    snap.word = room.prompt.text;
    if (room.prompt.category) {
      snap.category = room.prompt.category;
    }
  }
  if (room.drawRule === 'chain') {
    snap.guesserId = room.guesserId;
    if (room.chain) {
      snap.chainIndex = room.chain.chainIndex;
      snap.chainTotal = room.chain.chainTotal;
    }
    if (isDrawer && room.prompt) {
      snap.prompt = room.prompt.text;
      if (room.prompt.category) {
        snap.promptCategory = room.prompt.category;
      }
    }
  }
  return snap;
}

function resolveRoundsSpec(dto: CreateRoomDto): RoundsSpec {
  const r = dto.rounds;
  if (!r || !r.mode) {
    return { mode: 'fixed', value: r?.value ?? DEFAULT_ROUNDS };
  }
  if (r.mode === 'custom') {
    if (r.value == null) {
      throw new BadRequestException('custom 模式必须指定回合数 value（1–60）');
    }
    return { mode: 'custom', value: r.value };
  }
  if (r.mode === 'fixed') {
    return { mode: 'fixed', value: r.value ?? DEFAULT_ROUNDS };
  }
  return { mode: 'byPlayers' };
}

@Controller('rooms')
export class RoomsController {
  constructor(private readonly registry: RoomRegistry) {}

  @Post()
  create(
    @Body() dto: CreateRoomDto,
    @Req() req: Request & { user: { sub: string } },
  ): RoomSnapshot {
    const room = this.registry.create(req.user.sub, {
      orderRule: dto.orderRule ?? 'id',
      drawRule: dto.drawRule ?? 'classic',
      roundsSpec: resolveRoundsSpec(dto),
    });
    return roomSnapshot(room, req.user.sub);
  }

  @Get(':code')
  get(
    @Param('code') code: string,
    @Req() req: Request & { user: { sub: string } },
  ): RoomSnapshot {
    const room = this.registry.get(normalizeCode(code));
    if (!room) {
      throw new NotFoundException('房间不存在');
    }
    return roomSnapshot(room, req.user.sub);
  }
}
