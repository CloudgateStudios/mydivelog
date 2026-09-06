import type { Prisma, PrismaClient } from '../generated/client.ts';
import type { UserScope } from '../scope.ts';

export type GearInput = {
  kind: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  purchasedOn?: Date | null;
  serviceDueOn?: Date | null;
  isRental?: boolean;
};

/**
 * A diver's kit.
 *
 * Retiring is not deleting: a wetsuit you no longer own was still on four
 * hundred dives, and removing it would rewrite them. Retired items keep their
 * links and drop off the active list.
 */
export function createGearRepository(prisma: PrismaClient) {
  const owned = (scope: UserScope) => ({ userId: scope.userId, deletedAt: null });

  const summary = {
    id: true,
    kind: true,
    name: true,
    brand: true,
    model: true,
    serialNumber: true,
    purchasedOn: true,
    serviceDueOn: true,
    retiredAt: true,
    isRental: true,
  } satisfies Prisma.GearItemSelect;

  return {
    async list(scope: UserScope) {
      const items = await prisma.gearItem.findMany({
        where: owned(scope),
        select: { ...summary, _count: { select: { dives: true } } },
        orderBy: [{ retiredAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
      });
      return items.map(({ _count, ...item }) => ({ ...item, dives: _count.dives }));
    },

    /**
     * Attaches a new item to the dives whose imported gear text names it.
     *
     * Without this, accepting a suggestion that says "on 18 dives" produces an
     * item on zero — the count reads as a promise the page then breaks, and
     * the gear page stays disconnected from the logbook it came out of.
     *
     * Matched by name at this moment rather than from ids the page was holding,
     * so a dive imported since the page loaded is included and a deleted one
     * is not.
     */
    async linkImported(scope: UserScope, gearItemId: string, name: string) {
      const rows = await prisma.diveFieldProvenance.findMany({
        where: { dive: { userId: scope.userId, deletedAt: null }, fieldPath: 'gear' },
        select: { value: true, diveId: true },
      });

      const wanted = name.trim().toLowerCase();
      const diveIds = new Set<string>();
      for (const row of rows) {
        if (typeof row.value !== 'string') continue;
        // Exact piece, not a substring: "Boots" must not claim every dive that
        // mentions "Dive Boots (2mil)".
        if (row.value.split(',').some((piece) => piece.trim().toLowerCase() === wanted)) {
          diveIds.add(row.diveId);
        }
      }
      if (diveIds.size === 0) return 0;

      const { count } = await prisma.diveGear.createMany({
        data: [...diveIds].map((diveId) => ({ diveId, gearItemId })),
        skipDuplicates: true,
      });
      return count;
    },

    async create(scope: UserScope, id: string, input: GearInput) {
      return prisma.gearItem.create({
        data: {
          id,
          userId: scope.userId,
          kind: input.kind,
          name: input.name,
          brand: input.brand ?? null,
          model: input.model ?? null,
          serialNumber: input.serialNumber ?? null,
          purchasedOn: input.purchasedOn ?? null,
          serviceDueOn: input.serviceDueOn ?? null,
          isRental: input.isRental ?? false,
        },
        select: summary,
      });
    },

    async update(scope: UserScope, id: string, input: Partial<GearInput> & { retired?: boolean }) {
      const { count } = await prisma.gearItem.updateMany({
        where: { ...owned(scope), id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.brand === undefined ? {} : { brand: input.brand }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.serialNumber === undefined ? {} : { serialNumber: input.serialNumber }),
          ...(input.purchasedOn === undefined ? {} : { purchasedOn: input.purchasedOn }),
          ...(input.serviceDueOn === undefined ? {} : { serviceDueOn: input.serviceDueOn }),
          ...(input.isRental === undefined ? {} : { isRental: input.isRental }),
          // Retiring is reversible; the field is a date rather than a flag so
          // "when did I stop using this" is answerable.
          ...(input.retired === undefined ? {} : { retiredAt: input.retired ? new Date() : null }),
        },
      });
      if (count === 0) return null;
      return prisma.gearItem.findFirst({ where: { ...owned(scope), id }, select: summary });
    },

    /**
     * Deleting is only allowed while nothing depends on it.
     *
     * An item that has been on dives is retired instead — see the note above.
     * Returning a reason rather than a boolean lets the caller say which.
     */
    async remove(scope: UserScope, id: string): Promise<'deleted' | 'in-use' | 'missing'> {
      const item = await prisma.gearItem.findFirst({
        where: { ...owned(scope), id },
        select: { id: true, _count: { select: { dives: true } } },
      });
      if (!item) return 'missing';
      if (item._count.dives > 0) return 'in-use';

      await prisma.gearItem.updateMany({
        where: { ...owned(scope), id },
        data: { deletedAt: new Date() },
      });
      return 'deleted';
    },

    /**
     * Gear the importer already saw, that has no item yet.
     *
     * The spreadsheet's `Equipment` column arrives as free text — "Full Wet
     * Suit (5mil Rental), Boots (5mil Rental)" — and is kept as provenance
     * because splitting prose into equipment on import would be guessing. It
     * is not guessing here: the diver is looking at the list and confirming.
     *
     * Without this the gear page is empty for everyone who arrived by import,
     * which is everyone.
     */
    async suggestions(scope: UserScope) {
      const rows = await prisma.diveFieldProvenance.findMany({
        where: { dive: { userId: scope.userId, deletedAt: null }, fieldPath: 'gear' },
        select: { value: true, diveId: true },
      });

      const existing = new Set(
        (
          await prisma.gearItem.findMany({
            where: { userId: scope.userId },
            select: { name: true },
          })
        ).map((g) => g.name.trim().toLowerCase()),
      );

      const counts = new Map<string, Set<string>>();
      for (const row of rows) {
        if (typeof row.value !== 'string') continue;
        for (const piece of row.value.split(',')) {
          const name = piece.trim();
          // A comma inside a parenthesis — "Boots (5mil, Rental)" — leaves a
          // fragment that is not a piece of equipment.
          if (name.length < 3 || name.startsWith('(')) continue;
          if (existing.has(name.toLowerCase())) continue;
          const dives = counts.get(name) ?? new Set<string>();
          dives.add(row.diveId);
          counts.set(name, dives);
        }
      }

      return [...counts.entries()]
        .map(([name, dives]) => ({ name, dives: dives.size, kind: kindOf(name) }))
        .sort((a, b) => b.dives - a.dives || a.name.localeCompare(b.name));
    },
  };
}

/**
 * A guess at what a piece of kit is, from what it is called.
 *
 * Only a default for the form — the diver picks the kind when they confirm, so
 * a wrong guess costs one click and a right one costs none.
 */
function kindOf(name: string): string {
  const text = name.toLowerCase();
  if (/dry\s?suit/.test(text)) return 'drysuit';
  if (/wet\s?suit|shorty|jacket/.test(text)) return 'wetsuit';
  if (/\bbcd?\b|buoyancy|wing/.test(text)) return 'bcd';
  if (/reg(ulator)?|octo/.test(text)) return 'regulator';
  if (/computer|watch|perdix|shearwater/.test(text)) return 'computer';
  if (/fin/.test(text)) return 'fins';
  if (/boot/.test(text)) return 'boots';
  if (/hood/.test(text)) return 'hood';
  if (/glove/.test(text)) return 'gloves';
  if (/light|torch/.test(text)) return 'light';
  if (/camera|gopro/.test(text)) return 'camera';
  return 'other';
}
