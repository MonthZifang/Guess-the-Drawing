import type { WordCategory } from '../words/word-rules';

export const USER_STORE = 'USER_STORE';
export const WORD_STORE = 'WORD_STORE';
export const MATCH_STORE = 'MATCH_STORE';

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  avatarId: number;
  createdAt: Date;
}

export interface PublicUser {
  id: string;
  username: string;
  avatarId: number;
  createdAt: Date;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    avatarId: user.avatarId,
    createdAt: user.createdAt,
  };
}

export interface UserStore {
  create(input: {
    username: string;
    passwordHash: string;
    avatarId: number;
  }): Promise<UserRecord>;
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export interface WordRecord {
  id: string;
  text: string;
  category: WordCategory;
  difficulty: number;
}

export interface WordStore {
  all(): WordRecord[];
  /** 随机取词；排除 excludeTexts 中的词，若全部被排除则退回全量随机。 */
  random(excludeTexts?: ReadonlySet<string>): WordRecord | null;
}

export interface MatchPlayerRecord {
  userId: string;
  username: string;
  score: number;
  rank: number;
}

export interface MatchRecord {
  id: string;
  roomCode: string;
  rounds: number;
  endedAt: Date;
  players: MatchPlayerRecord[];
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  totalScore: number;
}

export interface MatchStore {
  save(input: {
    roomCode: string;
    rounds: number;
    endedAt: Date;
    players: MatchPlayerRecord[];
  }): Promise<MatchRecord>;
  /** 最近 N 场（新→旧）。 */
  recent(limit?: number): Promise<MatchRecord[]>;
  /** 按 MatchPlayer 总分排行 Top N。 */
  leaderboard(limit?: number): Promise<LeaderboardEntry[]>;
}
