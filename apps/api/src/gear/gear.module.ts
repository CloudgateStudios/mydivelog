import { Module } from '@nestjs/common';
import { GearController } from './gear.controller.ts';

@Module({ controllers: [GearController] })
export class GearModule {}
