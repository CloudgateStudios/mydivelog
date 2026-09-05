import { Global, Module } from '@nestjs/common';
import { StorageConfig } from './storage.config.ts';
import { StorageService } from './storage.service.ts';

@Global()
@Module({
  providers: [
    { provide: StorageConfig, useFactory: () => new StorageConfig(process.env) },
    StorageService,
  ],
  exports: [StorageConfig, StorageService],
})
export class StorageModule {}
