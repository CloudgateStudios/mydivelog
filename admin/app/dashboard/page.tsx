import { redirect } from "next/navigation";

import {
  AdminOverview,
  AdminUsersResponse,
  getAdminAuth,
  getAdminOverview,
  getAdminUsers,
  getHealth,
} from "../../lib/api";
import { LogoutButton } from "./logout-button";

type DashboardPageProps = {
  searchParams: Promise<{
    page?: string;
    search?: string;
  }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const auth = await getAdminAuth();

  if (!auth) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const [apiHealth, databaseHealth, overview, users] = await Promise.all([
    getHealth("/health"),
    getHealth("/health/db"),
    getAdminOverview(),
    getAdminUsers(resolvedSearchParams),
  ]);
  const sessionExpiry = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(auth.session.expiresAt));

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MyDiveLog</p>
          <h1>Admin Console</h1>
        </div>
        <LogoutButton />
      </header>

      <section className="dashboard-grid" aria-label="Service status">
        <StatusCard title="API" ok={apiHealth.ok} detail={apiHealth.data?.timestamp ?? "Unavailable"} />
        <StatusCard title="Database" ok={databaseHealth.ok} detail={databaseHealth.data?.timestamp ?? "Unavailable"} />
        <article className="status-card">
          <p className="card-label">Staff session</p>
          <h2>{auth.user.displayName ?? auth.user.email}</h2>
          <dl className="meta-list">
            <div>
              <dt>Email</dt>
              <dd>{auth.user.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{auth.user.role}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{sessionExpiry}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="work-queue" aria-label="Operational queues">
        <QueuePanel title="Users" value={formatCount(overview?.counts.users)} />
        <QueuePanel title="Dives" value={formatCount(overview?.counts.dives)} />
        <QueuePanel title="Imports" value={formatCount(overview?.counts.importBatches)} />
        <QueuePanel title="Canonical site review" value={formatCount(overview?.counts.pendingCanonicalSiteReviews)} />
      </section>

      <section className="admin-section" aria-labelledby="users-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Read-only</p>
            <h2 id="users-title">Users</h2>
          </div>
          <form className="search-form" action="/dashboard">
            <input
              aria-label="Search users"
              name="search"
              placeholder="Search email or name"
              type="search"
              defaultValue={resolvedSearchParams.search ?? ""}
            />
            <button type="submit">Search</button>
          </form>
        </div>
        <UsersTable users={users} />
      </section>

      <section className="admin-section two-column" aria-label="Recent activity">
        <RecentUsers overview={overview} />
        <RecentImports overview={overview} />
      </section>
    </main>
  );
}

function StatusCard({ title, ok, detail }: Readonly<{ title: string; ok: boolean; detail: string }>) {
  return (
    <article className="status-card">
      <div className="status-heading">
        <p className="card-label">{title}</p>
        <span className={ok ? "status-pill ok" : "status-pill down"}>{ok ? "Online" : "Needs attention"}</span>
      </div>
      <h2>{ok ? "Healthy" : "Unavailable"}</h2>
      <p className="muted">{detail}</p>
    </article>
  );
}

function QueuePanel({ title, value }: Readonly<{ title: string; value: string }>) {
  return (
    <article className="queue-panel">
      <p className="card-label">{title}</p>
      <h2>{value}</h2>
    </article>
  );
}

function UsersTable({ users }: Readonly<{ users: AdminUsersResponse | null }>) {
  if (!users) {
    return <p className="empty-state">Unable to load users.</p>;
  }

  if (users.users.length === 0) {
    return <p className="empty-state">No users match this view.</p>;
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Units</th>
              <th>Dives</th>
              <th>Imports</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.displayName ?? "Unnamed diver"}</strong>
                  <span>{user.email}</span>
                </td>
                <td>{user.role}</td>
                <td>{user.homeUnitSystem}</td>
                <td>{user.diveCount}</td>
                <td>{user.importBatchCount}</td>
                <td>{formatDate(user.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pagination-summary">
        Page {users.pagination.page} of {users.pagination.totalPages} · {users.pagination.total} total users
      </p>
    </>
  );
}

function RecentUsers({ overview }: Readonly<{ overview: AdminOverview | null }>) {
  return (
    <article className="activity-panel">
      <p className="card-label">Recent users</p>
      {overview?.recentUsers.length ? (
        <ul className="activity-list">
          {overview.recentUsers.map((user) => (
            <li key={user.id}>
              <span>{user.displayName ?? user.email}</span>
              <strong>{formatDate(user.createdAt)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">No recent users yet.</p>
      )}
    </article>
  );
}

function RecentImports({ overview }: Readonly<{ overview: AdminOverview | null }>) {
  return (
    <article className="activity-panel">
      <p className="card-label">Recent imports</p>
      {overview?.recentImports.length ? (
        <ul className="activity-list">
          {overview.recentImports.map((importBatch) => (
            <li key={importBatch.id}>
              <span>{importBatch.sourceFilename ?? importBatch.sourceType}</span>
              <strong>{importBatch.status}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">No imports yet.</p>
      )}
    </article>
  );
}

function formatCount(value?: number) {
  return value === undefined ? "Unavailable" : new Intl.NumberFormat("en").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}
