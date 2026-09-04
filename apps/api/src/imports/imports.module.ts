import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller.ts';
import { ImportsService } from './imports.service.ts';
import { ExportsController } from './exports.controller.ts';
import { ExportsService } from './exports.service.ts';

@Module({
  controllers: [ImportsController, ExportsController],
  providers: [ImportsService, ExportsService],
})
export class ImportsModule {}
