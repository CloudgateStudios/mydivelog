import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.ts';
import { AdminController } from './admin.controller.ts';

// MailModule because rejecting a suggested site name tells the diver why.
@Module({ imports: [MailModule], controllers: [AdminController] })
export class AdminModule {}
