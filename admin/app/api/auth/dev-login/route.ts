import { NextResponse } from "next/server";

import { getApiBaseUrl } from "../../../../lib/api";

export async function POST(request: Request) {
  const response = await fetch(`${getApiBaseUrl()}/auth/dev-login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: await request.text(),
    cache: "no-store"
  });
  const body = await response.text();
  const nextResponse = new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json"
    }
  });
  const setCookie = response.headers.get("set-cookie");

  if (setCookie) {
    nextResponse.headers.set("set-cookie", setCookie);
  }

  return nextResponse;
}
