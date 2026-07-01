import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADMIN_SESSION_TTL_MS, getSessionTtlMs, SESSION_COOKIE_NAMES, USER_SESSION_TTL_MS } from "./auth.config.js";

describe("auth config", () => {
  it("uses separate cookie names for browser, admin, and mobile sessions", () => {
    assert.equal(SESSION_COOKIE_NAMES.user, "mdl_session");
    assert.equal(SESSION_COOKIE_NAMES.admin, "mdl_admin_session");
    assert.equal(SESSION_COOKIE_NAMES.mobile, "mdl_mobile_session");
  });

  it("uses a shorter ttl for admin sessions", () => {
    assert.equal(getSessionTtlMs("user"), USER_SESSION_TTL_MS);
    assert.equal(getSessionTtlMs("mobile"), USER_SESSION_TTL_MS);
    assert.equal(getSessionTtlMs("admin"), ADMIN_SESSION_TTL_MS);
    assert.ok(ADMIN_SESSION_TTL_MS < USER_SESSION_TTL_MS);
  });
});
