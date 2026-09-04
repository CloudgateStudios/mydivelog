import { Module } from '@nestjs/common';
import { MailConfig } from './mail.config.ts';
import { MailService } from './mail.service.ts';

@Module({
  providers: [
    // Same reason as AuthConfig: the env object is a constructor parameter so
    // the class stays testable, which means Nest cannot resolve it by type.
    { provide: MailConfig, useFactory: () => new MailConfig(process.env) },
    MailService,
  ],
  exports: [MailConfig, MailService],
})
export class MailModule {}
