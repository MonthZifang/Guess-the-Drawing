import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';

@Module({
  imports: [RoomsModule, AuthModule],
  providers: [GameService, GameGateway],
  exports: [GameService],
})
export class GameModule {}
