import { Module } from '@nestjs/common';
import { PreferencesController } from './preferences.controller.ts';

@Module({ controllers: [PreferencesController] })
export class PreferencesModule {}
