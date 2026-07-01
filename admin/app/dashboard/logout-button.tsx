"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function logout() {
    setIsSubmitting(true);
    await fetch("/api/auth/logout", {
      method: "POST",
    });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button className="secondary-button" type="button" onClick={logout} disabled={isSubmitting}>
      {isSubmitting ? "Signing out..." : "Sign out"}
    </button>
  );
}
