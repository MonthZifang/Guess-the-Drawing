import { randomUUID } from 'node:crypto';
import type {
  LeaderboardEntry,
  MatchPlayerRecord,
  MatchRecord,
  MatchStore,
  UserRecord,
  UserStore,
  WordRecord,
  WordStore,
} from './stores';

export class MemoryUserStore implements UserStore {
  private byId = new Map<string, UserRecord>();
  private byUsername = new Map<string, UserRecord>();

  async create(input: {
    username: string;
    passwordHash: string;
    avatarId: number;
  }): Promise<UserRecord> {
    const user: UserRecord = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      avatarId: input.avatarId,
      createdAt: new Date(),
    };
    this.byId.set(user.id, user);
    this.byUsername.set(user.username, user);
    return user;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    return this.byUsername.get(username) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }
}

export class MemoryWordStore implements WordStore {
  private words: WordRecord[];

  constructor(words: WordRecord[]) {
    this.words = words;
  }

  all(): WordRecord[] {
    return [...this.words];
  }

  random(excludeTexts?: ReadonlySet<string>): WordRecord | null {
    if (this.words.length === 0) {
      return null;
    }
    let pool = this.words;
    if (excludeTexts && excludeTexts.size > 0) {
      const filtered = this.words.filter((w) => !excludeTexts.has(w.text));
      if (filtered.length > 0) {
        pool = filtered;
      }
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

export class MemoryMatchStore implements MatchStore {
  private matches: MatchRecord[] = [];

  async save(input: {
    roomCode: string;
    rounds: number;
    endedAt: Date;
    players: MatchPlayerRecord[];
  }): Promise<MatchRecord> {
    const match: MatchRecord = {
      id: randomUUID(),
      roomCode: input.roomCode,
      rounds: input.rounds,
      endedAt: input.endedAt,
      players: input.players,
    };
    this.matches.push(match);
    return match;
  }

  async recent(limit = 20): Promise<MatchRecord[]> {
    return this.matches.slice(-limit).reverse();
  }

  async leaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    const totals = new Map<string, LeaderboardEntry>();
    for (const match of this.matches) {
      for (const p of match.players) {
        const entry = totals.get(p.userId) ?? {
          userId: p.userId,
          username: p.username,
          totalScore: 0,
        };
        entry.totalScore += p.score;
        entry.username = p.username; // 保留最新一场的用户名
        totals.set(p.userId, entry);
      }
    }
    return [...totals.values()]
      .sort(
        (a, b) =>
          b.totalScore - a.totalScore || a.username.localeCompare(b.username),
      )
      .slice(0, limit);
  }
}
