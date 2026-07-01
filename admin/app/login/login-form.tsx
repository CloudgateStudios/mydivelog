"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type LoginState = "idle" | "submitting" | "error";

export function LoginForm() {
  const router = useRouter();
  const [state, setState] = useState<LoginState>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/dev-login", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email: formData.get("email"),
        displayName: formData.get("displayName"),
        role: "staff",
        sessionKind: "admin"
      })
    });

    if (!response.ok) {
      setState("error");
      setMessage("Unable to create a staff session. Confirm the API is running in development mode.");
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={onSubmit}>
      <label>
        <span>Email</span>
        <input name="email" type="email" defaultValue="staff@example.com" autoComplete="email" required />
      </label>
      <label>
        <span>Display name</span>
        <input name="displayName" type="text" defaultValue="Local Staff" autoComplete="name" required />
      </label>
      {message ? <p className="form-error">{message}</p> : null}
      <button type="submit" disabled={state === "submitting"}>
        {state === "submitting" ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
