import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { apiSend, withDone, withError } from '../../lib/api';
import { Notice, SubmitButton } from '../../components/StaffForm';
import { shortId } from '../../lib/format';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['entry', 'condition', 'environment', 'activity'] as const;

/**
 * The taxonomy, and the tags divers minted because it did not cover them.
 *
 * Editing is inline rather than on a detail page: a tag is four fields, and a
 * page per tag would put three clicks between noticing "forty people wrote
 * this one" and doing something about it.
 */
export default async function Tags({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { error, done } = await searchParams;

  const tags = await db.tag.findMany({
    orderBy: [{ isSystem: 'desc' }, { slug: 'asc' }],
    include: { _count: { select: { dives: true } } },
  });

  const system = tags.filter((t) => t.isSystem);
  const user = tags.filter((t) => !t.isSystem);

  async function update(formData: FormData): Promise<void> {
    'use server';
    const id = String(formData.get('id'));
    const result = await apiSend(`/v1/admin/tags/${id}`, {
      method: 'PATCH',
      body: {
        label: String(formData.get('label') ?? '').trim(),
        category: String(formData.get('category') ?? ''),
        isSystem: formData.get('isSystem') === 'on',
        reason: String(formData.get('reason') ?? '').trim() || undefined,
      },
    });
    redirect(result.ok ? withDone('/tags', 'Saved.') : withError('/tags', result.detail));
  }

  async function remove(formData: FormData): Promise<void> {
    'use server';
    const id = String(formData.get('id'));
    const result = await apiSend<{ dives: number }>(`/v1/admin/tags/${id}`, {
      method: 'DELETE',
      body: { reason: String(formData.get('reason') ?? '') },
    });
    if (!result.ok) redirect(withError('/tags', result.detail));
    redirect(
      withDone(
        '/tags',
        result.data.dives === 0
          ? 'Tag deleted.'
          : `Tag deleted. ${result.data.dives} ${
              result.data.dives === 1 ? 'dive' : 'dives'
            } lost the label; the dives themselves are untouched.`,
      ),
    );
  }

  return (
    <main>
      <h1>Tags</h1>
      <p className="lede">
        The seeded taxonomy is shared; anything a diver writes that it does not cover becomes their
        own tag. A user tag that many people have written is a candidate for promotion — and an
        empty system list means the seed has not run in this environment.
      </p>

      <Notice {...(error ? { error } : {})} {...(done ? { done } : {})} />

      <div className="cards">
        <div className="card">
          <div className="n">{system.length}</div>
          <div className="k">System</div>
        </div>
        <div className="card">
          <div className="n">{user.length}</div>
          <div className="k">User-created</div>
        </div>
      </div>

      <h2>System taxonomy</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Label</th>
              <th>Category</th>
              <th className="num">Dives</th>
              <th>Shared</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {system.map((tag) => (
              <TagRow key={tag.id} tag={tag} update={update} remove={remove} />
            ))}
          </tbody>
        </table>
        {system.length === 0 && (
          <p className="empty">
            No system tags. The reference-data seed has not run here — every diver will be minting
            private copies of common tags.
          </p>
        )}
      </div>

      <h2>User-created</h2>
      <p className="lede">
        Ticking <em>shared</em> promotes one into the taxonomy and detaches it from its owner, so
        the next diver who writes that word gets this tag instead of a private copy of it.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Label</th>
              <th>Category</th>
              <th className="num">Dives</th>
              <th>Shared</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {user.map((tag) => (
              <TagRow key={tag.id} tag={tag} update={update} remove={remove} showOwner />
            ))}
          </tbody>
        </table>
        {user.length === 0 && <p className="empty">None yet.</p>}
      </div>
    </main>
  );
}

type Tag = {
  id: string;
  slug: string;
  label: string;
  category: string;
  isSystem: boolean;
  userId: string | null;
  _count: { dives: number };
};

function TagRow({
  tag,
  update,
  remove,
  showOwner = false,
}: {
  tag: Tag;
  update: (formData: FormData) => Promise<void>;
  remove: (formData: FormData) => Promise<void>;
  showOwner?: boolean;
}) {
  return (
    <tr>
      <td className="mono">
        {tag.slug}
        {showOwner && tag.userId && (
          <div className="muted" style={{ fontSize: 11 }}>
            {shortId(tag.userId)}
          </div>
        )}
      </td>
      <td>
        <form action={update} id={`edit-${tag.id}`} className="inline">
          <input type="hidden" name="id" value={tag.id} />
          <label>
            <span className="visually-hidden">Label for {tag.slug}</span>
            <input name="label" defaultValue={tag.label} maxLength={80} required />
          </label>
        </form>
      </td>
      <td>
        <label>
          <span className="visually-hidden">Category for {tag.slug}</span>
          <select name="category" form={`edit-${tag.id}`} defaultValue={tag.category}>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      </td>
      <td className="num">{tag._count.dives}</td>
      <td>
        <label className="check">
          <input
            type="checkbox"
            name="isSystem"
            form={`edit-${tag.id}`}
            defaultChecked={tag.isSystem}
          />
          <span className="visually-hidden">Shared with everyone</span>
        </label>
      </td>
      <td className="num">
        <div className="actions">
          {/*
            `form=` rather than nesting. A form cannot span table cells and
            HTML has no nested forms, so every control in this row points at
            the one form in the label cell and this button submits it.

            No pending state on this button, unlike everywhere else in the
            panel: `useFormStatus` only reports for a form the component is
            inside, and this one deliberately is not. Acceptable here because
            the action is a single UPDATE — the slow actions (merge, revert)
            all sit in forms of their own, with the busy state intact.
          */}
          <button type="submit" form={`edit-${tag.id}`} className="button">
            Save
          </button>
          <details>
            <summary>Delete</summary>
            <form action={remove} className="stack">
              <input type="hidden" name="id" value={tag.id} />
              <p className="hint">
                {tag._count.dives === 0
                  ? 'Nothing is using this tag.'
                  : `${tag._count.dives} ${
                      tag._count.dives === 1 ? 'dive carries' : 'dives carry'
                    } this label and will lose it. The dives themselves are untouched.`}
              </p>
              <label>
                <span>Reason</span>
                <input name="reason" required minLength={3} maxLength={200} />
              </label>
              <SubmitButton danger>Delete {tag.slug}</SubmitButton>
            </form>
          </details>
        </div>
      </td>
    </tr>
  );
}
