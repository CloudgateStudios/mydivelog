import { redirect } from "next/navigation";

import { getAdminAuth } from "../../lib/api";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const auth = await getAdminAuth();

  if (auth) {
    redirect("/dashboard");
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">Staff console</p>
          <h1 id="login-title">MyDiveLog Admin</h1>
          <p className="login-copy">Sign in with a development staff session to review service status.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
