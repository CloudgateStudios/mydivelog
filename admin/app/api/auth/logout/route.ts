import { NextResponse } from "next/server";

import { getApiBaseUrl } from "../../../../lib/api";

const COOKIE_NAMES = ["mdl_session", "mdl_admin_session", "mdl_mobile_session"];

export async function POST(request: Request) {
  await fetch(`${getApiBaseUrl()}/auth/logout`, {
    method: "POST",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
    cache: "no-store",
  });

  const response = NextResponse.json({ status: "ok" });

  for (const cookieName of COOKIE_NAMES) {
    response.cookies.delete(cookieName);
  }

  return response;
}
