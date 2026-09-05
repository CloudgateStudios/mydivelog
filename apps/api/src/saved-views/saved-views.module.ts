import { Module } from '@nestjs/common';
import { SavedViewsController } from './saved-views.controller.ts';

@Module({ controllers: [SavedViewsController] })
export class SavedViewsModule {}
