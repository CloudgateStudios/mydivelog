import { redirect } from "next/navigation";

import { getAdminAuth, getHealth } from "../../lib/api";
import { LogoutButton } from "./logout-button";

export default async function DashboardPage() {
  const auth = await getAdminAuth();

  if (!auth) {
    redirect("/login");
  }

  const [apiHealth, databaseHealth] = await Promise.all([getHealth("/health"), getHealth("/health/db")]);
  const sessionExpiry = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
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
        <QueuePanel title="Users" value="Not wired yet" />
        <QueuePanel title="Imports" value="Not wired yet" />
        <QueuePanel title="Canonical site review" value="Not wired yet" />
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
