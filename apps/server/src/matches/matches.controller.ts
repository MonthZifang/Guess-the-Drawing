import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  LeaderboardEntry,
  MATCH_STORE,
  MatchRecord,
  MatchStore,
} from '../storage/stores';

@Controller('matches')
export class MatchesController {
  constructor(@Inject(MATCH_STORE) private readonly matches: MatchStore) {}

  @Get('recent')
  recent(@Query('limit') limit?: string): Promise<MatchRecord[]> {
    const n = Number(limit);
    const capped = Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20;
    return this.matches.recent(capped);
  }
}

@Controller('leaderboard')
export class LeaderboardController {
  constructor(@Inject(MATCH_STORE) private readonly matches: MatchStore) {}

  @Get()
  top(@Query('limit') limit?: string): Promise<LeaderboardEntry[]> {
    const n = Number(limit);
    const capped = Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 10;
    return this.matches.leaderboard(capped);
  }
}
