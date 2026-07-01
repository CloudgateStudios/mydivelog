import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_ADMIN_PAGE_SIZE, buildAdminUserSearchWhere, normalizeAdminPagination } from "./admin.query.js";

describe("admin query helpers", () => {
  it("normalizes pagination defaults", () => {
    assert.deepEqual(normalizeAdminPagination(), {
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    });
  });

  it("clamps pagination input", () => {
    assert.deepEqual(normalizeAdminPagination(-1, MAX_ADMIN_PAGE_SIZE + 1), {
      page: 1,
      pageSize: MAX_ADMIN_PAGE_SIZE,
      skip: 0,
      take: MAX_ADMIN_PAGE_SIZE,
    });
  });

  it("builds an empty user filter when search is blank", () => {
    assert.deepEqual(buildAdminUserSearchWhere("  "), {});
  });

  it("builds a case-insensitive user search filter", () => {
    assert.deepEqual(buildAdminUserSearchWhere("tom"), {
      OR: [
        {
          email: {
            contains: "tom",
            mode: "insensitive",
          },
        },
        {
          displayName: {
            contains: "tom",
            mode: "insensitive",
          },
        },
      ],
    });
  });
});
