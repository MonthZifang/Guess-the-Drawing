import { Module } from '@nestjs/common';
import { RoomRegistry } from './room.registry';
import { RoomsController } from './rooms.controller';

@Module({
  controllers: [RoomsController],
  providers: [RoomRegistry],
  exports: [RoomRegistry],
})
export class RoomsModule {}
