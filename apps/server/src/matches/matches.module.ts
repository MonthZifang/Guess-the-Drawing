import { Module } from '@nestjs/common';
import { LeaderboardController, MatchesController } from './matches.controller';

@Module({
  controllers: [MatchesController, LeaderboardController],
})
export class MatchesModule {}
