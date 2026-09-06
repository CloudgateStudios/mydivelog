import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller.ts';

@Module({ controllers: [SitesController] })
export class SitesModule {}
