import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getApiBaseUrl } from "./api";

const originalApiBaseUrl = process.env.ADMIN_API_BASE_URL;

describe("admin API config", () => {
  afterEach(() => {
    process.env.ADMIN_API_BASE_URL = originalApiBaseUrl;
  });

  it("defaults to the local API port", () => {
    delete process.env.ADMIN_API_BASE_URL;

    assert.equal(getApiBaseUrl(), "http://localhost:3000");
  });

  it("uses ADMIN_API_BASE_URL when provided", () => {
    process.env.ADMIN_API_BASE_URL = "https://api.example.test";

    assert.equal(getApiBaseUrl(), "https://api.example.test");
  });
});
