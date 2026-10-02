import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { GameModule } from './game/game.module';
import { HealthController } from './health.controller';
import { MatchesModule } from './matches/matches.module';
import { RoomsModule } from './rooms/rooms.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    StorageModule,
    AuthModule,
    RoomsModule,
    GameModule,
    MatchesModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
