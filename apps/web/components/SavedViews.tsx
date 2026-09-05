type SavedView = { id: string; name: string; query: string };

/**
 * Named filter sets, as links.
 *
 * A saved view is a URL, so opening one is a navigation and nothing more —
 * which is why the back button works, why a view can be opened in a new tab,
 * and why nothing here needs client JavaScript.
 */
export function SavedViews({
  views,
  current,
  suggestedName,
  save,
  remove,
}: {
  views: SavedView[];
  current: string;
  suggestedName: string;
  save: (formData: FormData) => Promise<void>;
  remove: (formData: FormData) => Promise<void>;
}) {
  const alreadySaved = views.some((view) => view.query === current);

  return (
    <section className="views" aria-label="Saved views">
      <ul className="view-list">
        <li>
          <a className={`chip link${current === 'sort=date_desc' ? ' on' : ''}`} href="/logbook">
            Everything
          </a>
        </li>
        {views.map((view) => (
          <li key={view.id}>
            <a
              className={`chip link${view.query === current ? ' on' : ''}`}
              href={`/logbook?${view.query}`}
            >
              {view.name}
            </a>
            <form action={remove} className="inline">
              <input type="hidden" name="id" value={view.id} />
              <button
                className="unbutton"
                type="submit"
                aria-label={`Delete the view “${view.name}”`}
                title={`Delete the view “${view.name}”`}
              >
                ×
              </button>
            </form>
          </li>
        ))}
      </ul>

      {/*
        Offered only once there is something to save, and hidden once this
        exact filter set already has a name — saving "Deep wrecks" twice makes
        a second identical row, and a diver reading two of them cannot tell
        which is which.
      */}
      {!alreadySaved && suggestedName && (
        <form action={save} className="save-view">
          <input type="hidden" name="query" value={current} />
          <label htmlFor="view-name">Save this view as</label>
          <input
            id="view-name"
            name="name"
            defaultValue={suggestedName}
            maxLength={60}
            required
            size={28}
          />
          <button className="button small" type="submit">
            Save
          </button>
        </form>
      )}
    </section>
  );
}
