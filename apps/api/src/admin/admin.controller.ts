import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AddSiteAlias,
  AdminUpdateDive,
  AdminUpdateSite,
  AdminUpdateTag,
  AdminUpdateUser,
  AuditQuery,
  DecideSiteName,
  MergeSites,
  StaffDelete,
} from '@mydivelog/contracts';
import {
  createAdminRepository,
  createImportRepository,
  createSuggestionRepository,
  getPrismaClient,
  StaffRefusal,
  SuggestionRefusal,
  userScope,
  type StaffScope,
} from '@mydivelog/db';
import { AuthConfig } from '../auth/auth.config.ts';
import { MailService } from '../mail/mail.service.ts';
import { zodBody } from '../common/zod-validation.pipe.ts';
import { conflict, notFound } from '../common/problem-details.ts';
import { Throttle } from '../common/rate-limit.guard.ts';
import { StaffOnly } from './staff.guard.ts';
import { Staff } from './staff.decorator.ts';

/**
 * `/v1/admin` — the staff surface, per docs/06-api-design.md.
 *
 * Separate router, separate guard, separate hostname, and every call that
 * changes anything writes an `AuditEvent`. That last part is not enforced here:
 * it is enforced in `@mydivelog/db`'s admin repository, where the audit row and
 * the change share a transaction. This controller could not skip it without
 * bypassing the repository entirely, and `admin.itest.ts` counts the rows to
 * prove it.
 *
 * `@StaffOnly()` sits on the class rather than on each method deliberately.
 * The usual rule — never guard a controller, guard each route — protects
 * against a new route being added unguarded. Here it is the reverse: the
 * default for anything added to this file must be "staff only", and marking
 * routes individually is what would fail open.
 */
@Controller('admin')
@StaffOnly()
export class AdminController {
  private readonly repo = createAdminRepository(getPrismaClient());
  private readonly imports = createImportRepository(getPrismaClient());
  private readonly suggestions = createSuggestionRepository(getPrismaClient());
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly mail: MailService,
    private readonly authConfig: AuthConfig,
  ) {}

  // -------------------------------------------------------------------------
  // The log
  // -------------------------------------------------------------------------

  @Get('audit')
  async audit(@Query() query: Record<string, string>) {
    const q = AuditQuery.parse(query);
    return { data: await this.repo.listAudit(q) };
  }

  // -------------------------------------------------------------------------
  // Sites
  // -------------------------------------------------------------------------

  @Patch('sites/:id')
  async updateSite(
    @Staff('edited a site') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(AdminUpdateSite)) body: AdminUpdateSite,
  ) {
    const { reason: _reason, ...changes } = body;
    const result = await refuseCleanly(() => this.repo.updateSite(scope, id, changes));
    if (!result) throw notFound('Site');
    return result.site;
  }

  /**
   * Only for a site with no dives at it. The repository refuses otherwise and
   * says to merge instead; that refusal arrives here as a 409 with the sentence
   * intact, because "merge it" is the actual next step and hiding it behind a
   * generic conflict makes the caller guess.
   */
  @Delete('sites/:id')
  @HttpCode(200)
  @Throttle(30, 60_000)
  async deleteSite(
    @Staff('deleted a site') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(StaffDelete)) _body: StaffDelete,
  ) {
    const result = await refuseCleanly(() => this.repo.deleteSite(scope, id));
    if (!result) throw notFound('Site');
    return result;
  }

  @Post('sites/:id/aliases')
  @HttpCode(201)
  async addAlias(
    @Staff('added a site alias') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(AddSiteAlias)) body: AddSiteAlias,
  ) {
    const result = await refuseCleanly(() => this.repo.addSiteAlias(scope, id, body.name));
    if (!result) throw notFound('Site');
    return result;
  }

  @Delete('sites/:id/aliases/:aliasId')
  @HttpCode(204)
  async removeAlias(
    @Staff('removed a site alias') scope: StaffScope,
    @Param('id') id: string,
    @Param('aliasId') aliasId: string,
  ) {
    if (!(await refuseCleanly(() => this.repo.removeSiteAlias(scope, id, aliasId)))) {
      throw notFound('Alias');
    }
  }

  @Post('sites/merge')
  // 200, not Nest's default 201: a merge creates nothing. It folds one
  // existing site into another and the response is a summary of what moved.
  @HttpCode(200)
  @Throttle(30, 60_000)
  async mergeSites(
    @Staff('merged two sites') scope: StaffScope,
    @Body(zodBody(MergeSites)) body: MergeSites,
  ) {
    const result = await refuseCleanly(() =>
      this.repo.mergeSites(scope, body.sourceId, body.targetId),
    );
    if (!result) throw notFound('Site');
    return result;
  }

  // -------------------------------------------------------------------------
  // Suggested site names
  // -------------------------------------------------------------------------

  @Get('site-name-suggestions')
  async siteNameSuggestions() {
    return { data: await this.suggestions.pending() };
  }

  @Post('site-name-suggestions/:id/decide')
  // 200: deciding creates nothing. It answers a request that already exists.
  @HttpCode(200)
  async decideSiteName(
    @Staff('decided a suggested site name') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(DecideSiteName)) body: DecideSiteName,
  ) {
    const result = await refuseCleanly(() =>
      this.suggestions.decide(scope, id, body.outcome, body.note, this.repo.writeAuditIn),
    );
    if (!result) throw notFound('Suggestion');

    if (result.outcome !== 'rejected' || !result.note) return { ...result, notified: false };

    // After the transaction, and deliberately not inside it: an email provider
    // being down must not roll back a decision staff already made. The answer
    // lives on the suggestion row, which the diver's site page shows, so the
    // worst case is a notice that never arrives rather than a decision that
    // never happened.
    //
    // Reported rather than assumed, so the panel can say what actually
    // happened. "The diver has been told why" printed over a send that never
    // left the building is the failure this whole feature exists to avoid.
    const notified = await this.notifyRejected(result.diverEmail, {
      proposed: result.proposed,
      siteName: result.previousName,
      note: result.note,
      siteId: result.siteId,
    });
    return { ...result, notified };
  }

  /** True only if the message actually went out. */
  private async notifyRejected(
    email: string,
    detail: { proposed: string; siteName: string; note: string; siteId: string },
  ): Promise<boolean> {
    if (!this.mail.configured) {
      this.mail.logUnconfigured(email);
      return false;
    }
    try {
      await this.mail.sendNameSuggestionRejected(email, {
        proposed: detail.proposed,
        siteName: detail.siteName,
        note: detail.note,
        siteUrl: `${this.authConfig.appUrl}/sites/${detail.siteId}`,
      });
      return true;
    } catch (err) {
      this.logger.error(
        `could not tell ${email} their suggested site name was declined: ${String(err)}`,
      );
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  @Patch('tags/:id')
  async updateTag(
    @Staff('edited a tag') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(AdminUpdateTag)) body: AdminUpdateTag,
  ) {
    const { reason: _reason, ...changes } = body;
    const result = await refuseCleanly(() => this.repo.updateTag(scope, id, changes));
    if (!result) throw notFound('Tag');
    return result.tag;
  }

  @Delete('tags/:id')
  @HttpCode(200)
  @Throttle(30, 60_000)
  async deleteTag(
    @Staff('deleted a tag') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(StaffDelete)) _body: StaffDelete,
  ) {
    const result = await refuseCleanly(() => this.repo.deleteTag(scope, id));
    if (!result) throw notFound('Tag');
    return result;
  }

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  @Patch('users/:id')
  @Throttle(30, 60_000)
  async updateUser(
    @Staff('changed an account status') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(AdminUpdateUser)) body: AdminUpdateUser,
  ) {
    const result = await refuseCleanly(() => this.repo.setUserStatus(scope, id, body.status));
    if (!result) throw notFound('User');
    return result;
  }

  /** Soft. See the repository — a hard delete here cascades to everything. */
  @Delete('users/:id')
  @HttpCode(200)
  @Throttle(10, 60_000)
  async deleteUser(
    @Staff('deleted an account') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(StaffDelete)) _body: StaffDelete,
  ) {
    const result = await refuseCleanly(() => this.repo.deleteUser(scope, id));
    if (!result) throw notFound('User');
    return result;
  }

  // -------------------------------------------------------------------------
  // Dives
  // -------------------------------------------------------------------------

  @Patch('dives/:id')
  async updateDive(
    @Staff('corrected a dive') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(AdminUpdateDive)) body: AdminUpdateDive,
  ) {
    const { reason: _reason, startTimeUtc, startTimeLocal, ...rest } = body;
    const result = await refuseCleanly(() =>
      this.repo.updateDive(scope, id, {
        ...rest,
        ...(startTimeUtc === undefined ? {} : { startTimeUtc: new Date(startTimeUtc) }),
        // No `Z`, no offset: this is wall-clock time and parsing it as UTC is
        // what keeps it wall-clock in a timestamp column.
        ...(startTimeLocal === undefined ? {} : { startTimeLocal: new Date(`${startTimeLocal}Z`) }),
      }),
    );
    if (!result) throw notFound('Dive');
    return result.dive;
  }

  @Delete('dives/:id')
  @HttpCode(200)
  @Throttle(60, 60_000)
  async deleteDive(
    @Staff('deleted a dive') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(StaffDelete)) _body: StaffDelete,
  ) {
    const result = await refuseCleanly(() => this.repo.softDeleteDive(scope, id));
    if (!result) throw notFound('Dive');
    return result;
  }

  @Post('dives/:id/restore')
  @HttpCode(200)
  async restoreDive(@Staff('restored a dive') scope: StaffScope, @Param('id') id: string) {
    const result = await refuseCleanly(() => this.repo.restoreDive(scope, id));
    if (!result) throw notFound('Dive');
    return result;
  }

  // -------------------------------------------------------------------------
  // Imports
  // -------------------------------------------------------------------------

  /**
   * Undo a committed import on the diver's behalf.
   *
   * The revert itself is the same code path the diver's own undo button uses,
   * scoped to whoever owns the batch rather than to the staff member — staff
   * are triggering the diver's action, not performing a different one. The
   * audit row is written by a hook inside the revert's transaction, so the undo
   * and the record of who asked for it commit together.
   */
  @Post('imports/:id/revert')
  @HttpCode(200)
  @Throttle(10, 60_000)
  async revertImport(
    @Staff('reverted an import') scope: StaffScope,
    @Param('id') id: string,
    @Body(zodBody(StaffDelete)) _body: StaffDelete,
  ) {
    const batch = await getPrismaClient().importBatch.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true, originalFileName: true },
    });
    if (!batch) throw notFound('Import batch');
    if (batch.status !== 'committed') {
      throw conflict(
        `This batch is "${batch.status}", and only a committed import can be reverted.`,
        'not_committed',
      );
    }

    const result = await this.imports.revert(userScope(batch.userId), id, {
      inTransaction: (tx) =>
        this.repo.writeAuditIn(tx, scope, {
          action: 'import.revert',
          entityType: 'import_batch',
          entityId: id,
          metadata: { userId: batch.userId, fileName: batch.originalFileName },
        }),
    });
    return result;
  }
}

/**
 * A refusal is a 409 with its sentence intact.
 *
 * The repository refuses things that would silently destroy data — a site with
 * dives at it, a dive number already in use — and each refusal carries the
 * action that would work instead. Flattening those into a generic conflict
 * throws away the only useful part.
 */
async function refuseCleanly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Both refusals mean the same thing to a caller: the request was
    // understood and the state of the world says no.
    if (err instanceof StaffRefusal || err instanceof SuggestionRefusal) {
      throw conflict(err.message, err.code);
    }
    throw err;
  }
}
