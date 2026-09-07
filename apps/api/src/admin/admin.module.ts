import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.ts';

@Module({ controllers: [AdminController] })
export class AdminModule {}
