import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { OrderRule, RoundsSpec } from '../game/rotation';
import {
  DEFAULT_ROUNDS,
  DrawRule,
  MAX_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROUND_SECONDS,
  Room,
} from './room.types';

export interface CreateRoomRules {
  orderRule: OrderRule;
  drawRule: DrawRule;
  roundsSpec: RoundsSpec;
}

@Injectable()
export class RoomRegistry {
  private rooms = new Map<string, Room>();

  create(ownerId: string, rules?: Partial<CreateRoomRules>): Room {
    const code = this.generateCode();
    const roundsSpec = rules?.roundsSpec ?? {
      mode: 'fixed' as const,
      value: DEFAULT_ROUNDS,
    };
    const room: Room = {
      code,
      ownerId,
      maxPlayers: MAX_PLAYERS,
      orderRule: rules?.orderRule ?? 'id',
      drawRule: rules?.drawRule ?? 'classic',
      roundsSpec,
      totalRounds:
        roundsSpec.mode === 'byPlayers'
          ? null
          : roundsSpec.mode === 'custom'
            ? roundsSpec.value ?? DEFAULT_ROUNDS
            : roundsSpec.value ?? DEFAULT_ROUNDS,
      roundSeconds: ROUND_SECONDS,
      status: 'waiting',
      phase: null,
      players: [],
      roundNo: 0,
      strokes: [],
      drawerId: null,
      guesserId: null,
      word: null,
      prompt: null,
      lastGuessInput: null,
      endsAt: null,
      usedWordTexts: new Set<string>(),
      rotation: null,
      chain: null,
      timer: null,
      pauseTimer: null,
      voteTimer: null,
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
    if (room.voteTimer) {
      clearTimeout(room.voteTimer);
      room.voteTimer = null;
    }
  }

  private generateCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        // 32 整除 256：randomBytes 取模等概率；randomInt 同样均匀
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
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
