import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ROUNDS,
  MAX_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROUND_SECONDS,
  Room,
} from './room.types';

@Injectable()
export class RoomRegistry {
  private rooms = new Map<string, Room>();

  create(ownerId: string): Room {
    const code = this.generateCode();
    const room: Room = {
      code,
      ownerId,
      maxPlayers: MAX_PLAYERS,
      rounds: DEFAULT_ROUNDS,
      roundSeconds: ROUND_SECONDS,
      status: 'waiting',
      phase: null,
      players: [],
      roundNo: 0,
      strokes: [],
      drawerId: null,
      word: null,
      endsAt: null,
      usedWordTexts: new Set<string>(),
      timer: null,
      pauseTimer: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  delete(code: string): void {
    this.clearTimers(this.rooms.get(code));
    this.rooms.delete(code);
  }

  private clearTimers(room?: Room): void {
    if (!room) {
      return;
    }
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    if (room.pauseTimer) {
      clearTimeout(room.pauseTimer);
      room.pauseTimer = null;
    }
  }

  private generateCode(): string {
    for (;;) {
      let code = '';
      const bytes = new Uint32Array(4);
      // 简单确定性无关的随机来源
      for (let i = 0; i < 4; i++) {
        bytes[i] = Math.floor(Math.random() * 0xffffffff);
      }
      for (let i = 0; i < 4; i++) {
        code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
  }
}

export function normalizeCode(code: string): string {
  return String(code ?? '')
    .trim()
    .toUpperCase();
}
