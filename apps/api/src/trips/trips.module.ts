import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller.ts';

@Module({ controllers: [TripsController] })
export class TripsModule {}
