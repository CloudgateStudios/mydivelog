import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_UPLOAD_BYTES, UpdateImportRow } from '@mydivelog/contracts';
import { userScope } from '@mydivelog/db';
import { badRequest } from '../common/problem-details.ts';
import { Throttle } from '../common/rate-limit.guard.ts';
import { zodBody } from '../common/zod-validation.pipe.ts';
import { CurrentUser } from '../auth/current-user.decorator.ts';
import type { AuthedUser } from '../auth/session.guard.ts';
import { ImportsService } from './imports.service.ts';
import { toBatchDetail, toBatchSummary } from './presenters.ts';

/** A dive log is not a large file, and a 50 MB XML is not one either. */

/**
 * Only what this controller reads.
 *
 * `Express.Multer.File` is a global namespace augmentation that resolves only
 * when multer's types are in scope, which makes the build depend on the type
 * resolution order rather than on an import. Naming the three fields used here
 * is both smaller and harder to break.
 */
type UploadedFileLike = {
  originalname: string;
  size: number;
  buffer: Buffer;
};

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  async list(@CurrentUser() user: AuthedUser) {
    const batches = await this.imports.list(userScope(user.id));
    return { data: batches.map(toBatchSummary) };
  }

  /**
   * Upload, parse and match. Returns the proposal, writes nothing to the
   * logbook — an import is a staged pipeline with human review, never a direct
   * write.
   */
  @Post()
  @HttpCode(201)
  // Parsing a large file is real work, and a diver has a handful of files, not
  // hundreds.
  @Throttle(20, 60 * 60_000)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async create(@CurrentUser() user: AuthedUser, @UploadedFile() file?: UploadedFileLike) {
    if (!file) throw badRequest('No file was uploaded.', 'missing_file');
    if (file.size === 0) throw badRequest('The uploaded file is empty.', 'empty_file');

    const batchId = await this.imports.create(
      userScope(user.id),
      file.originalname,
      new Uint8Array(file.buffer),
    );
    const batch = await this.imports.get(userScope(user.id), batchId);
    return toBatchDetail(batch);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return toBatchDetail(await this.imports.get(userScope(user.id), id));
  }

  /** Overrides one row's decision before commit. */
  @Post(':id/rows/:rowIndex')
  @HttpCode(204)
  async updateRow(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('rowIndex', ParseIntPipe) rowIndex: number,
    @Body(zodBody(UpdateImportRow)) body: UpdateImportRow,
  ): Promise<void> {
    await this.imports.updateRow(
      userScope(user.id),
      id,
      rowIndex,
      body.decision,
      body.matchDiveId ?? null,
    );
  }

  @Post(':id/commit')
  @HttpCode(200)
  async commit(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const result = await this.imports.commit(userScope(user.id), id);
    return {
      batchId: result.batchId,
      created: result.created.length,
      merged: result.merged.length,
      skipped: result.skipped,
      replayed: result.replayed,
    };
  }

  /**
   * Undoes a committed import. Available indefinitely: a diver who knows they
   * can undo will import, and one who is not sure will not.
   */
  @Post(':id/revert')
  @HttpCode(200)
  async revert(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const result = await this.imports.revert(userScope(user.id), id);
    return {
      batchId: id,
      deleted: result.deleted.length,
      restored: result.restored.length,
    };
  }
}
