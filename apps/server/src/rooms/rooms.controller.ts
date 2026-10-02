import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { normalizeCode, RoomRegistry } from './room.registry';
import { Room } from './room.types';

export interface RoomSnapshot {
  code: string;
  ownerId: string;
  status: Room['status'];
  roundNo: number;
  maxPlayers: number;
  rounds: number;
  roundSeconds: number;
  players: Array<{
    userId: string;
    username: string;
    avatarId: number;
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
}

export function roomSnapshot(room: Room, requesterId?: string): RoomSnapshot {
  const snap: RoomSnapshot = {
    code: room.code,
    ownerId: room.ownerId,
    status: room.status,
    roundNo: room.roundNo,
    maxPlayers: room.maxPlayers,
    rounds: room.rounds,
    roundSeconds: room.roundSeconds,
    players: room.players.map((p) => ({
      userId: p.userId,
      username: p.username,
      avatarId: p.avatarId,
      score: p.score,
      guessed: p.guessed,
    })),
    strokes: room.strokes,
    drawerId: room.drawerId,
    charCount: room.word ? room.word.text.length : null,
    endsAt: room.endsAt,
  };
  if (room.word && requesterId && room.drawerId === requesterId) {
    snap.word = room.word.text;
    snap.category = room.word.category;
  }
  return snap;
}

@Controller('rooms')
export class RoomsController {
  constructor(private readonly registry: RoomRegistry) {}

  @Post()
  create(@Req() req: Request & { user: { sub: string } }): RoomSnapshot {
    const room = this.registry.create(req.user.sub);
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
