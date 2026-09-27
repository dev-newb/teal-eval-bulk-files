"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash, webcrypto } = require("node:crypto");
const vm = require("node:vm");
const { createStore } = require("../extension/bridge-plan-store.js");

const context = { crypto: webcrypto, URL, AbortSignal, Uint8Array, Date };
context.globalThis = context;
vm.runInNewContext(readFileSync(require.resolve("../extension/api-upload.js"), "utf8"), context);
const api = context.TealEvalApiUpload;
const origin = "http://127.0.0.1:8769";
const issue = "TAB-TEST";
const uuid = "11111111-1111-4111-8111-111111111111";

function file(name, bytes, type = "application/pdf") {
  const data = Buffer.from(bytes);
  return { name, type, size: data.length, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
}

function response(url, status, body) {
  return { url, status, ok: status >= 200 && status < 300, redirected: false,
    json: async () => body };
}

function harness(options = {}) {
  const calls = [];
  const rows = [...(options.rows || [])];
  const records = [];
  let current = true;
  let registered = false;
  let readsAfterRegister = 0;
  const fetchImpl = async (url, request) => {
    const path = new URL(url).pathname;
    calls.push({ url, request });
    if (path === "/api/staged-files" && request.method === "GET") {
      if (options.authFail) return response(url, 401, { error: "do not print this secret" });
      if (registered) readsAfterRegister += 1;
      const visible = !registered || readsAfterRegister >= (options.visibleAfterReads || 1);
      return response(url, 200, options.badList ? { files: [] } : { rows: visible ? rows : [] });
    }
    if (path === "/api/storage/staged-upload-url") {
      const filename = options.filename || options.input.name;
      return response(url, 200, options.prepare || {
        upload_url: `${origin}/mock-upload/${issue}/${uuid}/${encodeURIComponent(filename)}`,
        storage_key: `${issue}/${uuid}/${filename}`,
        bucket: "test-bucket", region: "us-east-1"
      });
    }
    if (path.startsWith("/mock-upload/")) {
      if (options.putFailure) return response(url, 403, {});
      if (options.navigateAfterPut) current = false;
      return response(url, 200, {});
    }
    if (path === "/api/staged-files" && request.method === "POST") {
      if (options.registerTimeoutNoRow) throw Object.assign(new Error("network detail must stay private"), { name: "TimeoutError" });
      const body = JSON.parse(request.body);
      const bytes = Buffer.from(await options.input.arrayBuffer());
      rows.push({ filename: body.filename,
        sha256: options.wrongHash ? "f".repeat(64) : createHash("sha256").update(bytes).digest("hex"),
        byte_size: options.wrongSize ? bytes.length + 1 : bytes.length });
      registered = true;
      if (options.lostRegister) throw new Error("secret signed URL should not leak");
      return response(url, 200, { row: rows.at(-1) });
    }
    throw new Error(`unexpected request ${path}`);
  };
  const client = api.createClient({ origin, issueIdentifier: issue, fetchImpl,
    isCurrent: () => current, recordPartial: async (record) => records.push(record),
    ...(options.clientOptions || {}) });
  return { client, calls, rows, records };
}

test("Direct API uses exact bytes and verifies full SHA-256 and size", async () => {
  const input = file("x.pdf", [0, 1, 2, 255]);
  const h = harness({ input });
  const result = await h.client.uploadOne(input);
  assert.equal(result.sha256, createHash("sha256").update(Buffer.from([0, 1, 2, 255])).digest("hex"));
  assert.equal(result.byteSize, 4);
  assert.equal(result.rows.length, 1);
  assert.equal(h.calls.filter((call) => call.request.method === "POST" && call.url.endsWith("/api/staged-files")).length, 1);
  const put = h.calls.find((call) => call.request.method === "PUT");
  assert.equal(put.request.body, input);
  assert.deepEqual([...new Uint8Array(await put.request.body.arrayBuffer())], [0, 1, 2, 255]);
  assert.equal(put.request.credentials, "omit");
  assert.equal(h.records.at(-1).phase, "verified");
  assert.ok(h.calls.every((call) => call.request.redirect === "error"));
});

test("encoded filename spaces remain tied to the exact storage key", async () => {
  const input = file("my file.pdf", [32, 40]);
  const h = harness({ input });
  const result = await h.client.uploadOne(input);
  assert.equal(result.rows[0].filename, input.name);
  assert.ok(h.calls.some((call) => call.request.method === "PUT" && call.url.includes("my%20file.pdf")));
  const key = `${issue}/${uuid}/my file.pdf`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": "access/20260926/us-east-1/s3/aws4_request",
    "X-Amz-Signature": "a".repeat(64),
    "X-Amz-Date": "20260926T000000Z", "X-Amz-Expires": "3600"
  });
  const destination = `https://test-bucket.s3.us-east-1.amazonaws.com/${key.replace("my file.pdf", "my%20file.pdf")}?${params}`;
  assert.equal(api.validateDestination({ upload_url: destination, storage_key: key,
    bucket: "test-bucket", region: "us-east-1" }, issue, input.name, false), destination);
});

test("duplicate is skipped before any mutation", async () => {
  const input = file("x.pdf", [1]);
  const h = harness({ input, rows: [{ filename: "x.pdf", sha256: "a".repeat(64), byte_size: 1 }] });
  const result = await h.client.uploadOne(input);
  assert.equal(result.skipped, true);
  assert.equal(h.calls.length, 1);
});

test("authentication and schema failures do not start mutation", async () => {
  const input = file("x.pdf", [1]);
  for (const settings of [{ authFail: true }, { badList: true }]) {
    const h = harness({ input, ...settings });
    await assert.rejects(h.client.uploadOne(input), /inventory/i);
    assert.equal(h.calls.length, 1);
  }
});

test("unsafe destination is rejected before PUT or registration", async () => {
  const input = file("x.pdf", [1]);
  for (const upload_url of [
    "https://evil.example/TAB-TEST/11111111-1111-4111-8111-111111111111/x.pdf",
    `${origin}/mock-upload/TAB-TEST/${uuid}/x.pdf#fragment`,
    `${origin}/mock-upload/TAB-TEST/${uuid}/other.pdf`
  ]) {
    const h = harness({ input, prepare: { upload_url, storage_key: `${issue}/${uuid}/x.pdf`, bucket: "test-bucket", region: "us-east-1" } });
    await assert.rejects(h.client.uploadOne(input), /URL|destination|file/i);
    assert.equal(h.calls.filter((call) => call.request.method === "PUT").length, 0);
  }
});

test("PUT failure never registers", async () => {
  const input = file("x.pdf", [1]);
  const h = harness({ input, putFailure: true });
  await assert.rejects(h.client.uploadOne(input), /PUT/i);
  assert.equal(h.calls.filter((call) => call.url.endsWith("/api/staged-files") && call.request.method === "POST").length, 0);
  assert.equal(h.records.at(-1).phase, "prepared");
});

test("lost registration response reconciles by GET without a second POST", async () => {
  const input = file("x.pdf", [1, 2]);
  const h = harness({ input, lostRegister: true });
  const result = await h.client.uploadOne(input);
  assert.equal(result.reconciled, true);
  assert.equal(h.calls.filter((call) => call.url.endsWith("/api/staged-files") && call.request.method === "POST").length, 1);
  assert.equal(h.calls.filter((call) => call.request.method === "GET").length, 2);
});

test("write requests have longer bounded timeouts than read-only inventory GET", async () => {
  const input = file("x.pdf", [1]);
  const timeouts = [];
  const clock = { value: 0 };
  const h = harness({ input, clientOptions: {
    now: () => clock.value, deadline: 2 * 60 * 60_000,
    timeoutSignal: (ms) => { timeouts.push(ms); return new AbortController().signal; }
  } });
  await h.client.uploadOne(input);
  assert.deepEqual(h.calls.map((call) => call.request.method), ["GET", "POST", "PUT", "POST", "GET"]);
  assert.deepEqual(timeouts, [60_000, 10 * 60_000, 2 * 60 * 60_000, 10 * 60_000, 60_000]);

  const nearDeadline = [];
  const short = harness({ input, clientOptions: {
    now: () => 0, deadline: 100_000,
    timeoutSignal: (ms) => { nearDeadline.push(ms); return new AbortController().signal; }
  } });
  await short.client.uploadOne(input);
  assert.deepEqual(nearDeadline, [60_000, 100_000, 100_000, 100_000, 60_000]);
});

test("a late visible row resolves a lost response using read-only checks", async () => {
  const input = file("x.pdf", [5]);
  let clock = 0;
  const sleeps = [];
  const h = harness({ input, lostRegister: true, visibleAfterReads: 3, clientOptions: {
    now: () => clock, deadline: 100_000, reconciliationWindowMs: 5_000,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; }
  } });
  const result = await h.client.uploadOne(input);
  assert.equal(result.reconciled, true);
  assert.deepEqual(sleeps, [2_000, 2_000]);
  assert.equal(h.calls.filter((call) => call.request.method === "POST" && call.url.endsWith("/api/staged-files")).length, 1);
  assert.equal(h.calls.filter((call) => call.request.method === "GET").length, 4);
});

test("a registration timeout keeps safe diagnostics and stops after bounded read-only checks", async () => {
  const input = file("x.pdf", [8]);
  let clock = 0;
  const h = harness({ input, registerTimeoutNoRow: true, clientOptions: {
    now: () => clock, deadline: 100_000, reconciliationWindowMs: 3_000,
    sleep: async (ms) => { clock += ms; }
  } });
  await assert.rejects(h.client.uploadOne(input), (error) => {
    assert.equal(error.code, "verify");
    assert.equal(error.indeterminate, true);
    assert.equal(error.stage, "reconcile");
    assert.equal(error.reason, "timeout");
    assert.match(error.message, /timed out/i);
    assert.doesNotMatch(error.message, /network detail|mock-upload|X-Amz/i);
    return true;
  });
  assert.equal(clock, 3_000);
  assert.equal(h.calls.filter((call) => call.request.method === "POST" && call.url.endsWith("/api/staged-files")).length, 1);
  assert.equal(h.calls.filter((call) => call.request.method === "GET").length, 3);
});

test("server hash or size mismatch is uncertain and never retried", async () => {
  const input = file("x.pdf", [1]);
  for (const settings of [{ wrongHash: true }, { wrongSize: true }]) {
    const h = harness({ input, ...settings });
    await assert.rejects(h.client.uploadOne(input), (error) => error.code === "verify" && error.indeterminate);
    assert.equal(h.calls.filter((call) => call.url.endsWith("/api/staged-files") && call.request.method === "POST").length, 1);
  }
});

test("navigation after PUT prevents registration or later mutation", async () => {
  const input = file("x.pdf", [1]);
  const h = harness({ input, navigateAfterPut: true });
  await assert.rejects(h.client.uploadOne(input), (error) => error.code === "stopped");
  assert.equal(h.calls.filter((call) => call.url.endsWith("/api/staged-files") && call.request.method === "POST").length, 0);
});

test("one-use plan binds upload mode and consumes on mismatch", async () => {
  const store = createStore({ ttlMs: 1000, authorizationPattern: /^[a-z0-9-]{16,80}$/,
    createAuthorizationId: () => "11111111-1111-4111-8111-111111111111", now: () => 1,
    getInventory: () => [], parseNames: (names) => names });
  const authorizationId = store.create({ operation: "upload", uploadMode: "api", requestedNames: ["x.pdf"], inventory: [], files: [] });
  await assert.rejects(store.consumeAsync({ authorizationId, operation: "upload", uploadMode: "native", names: ["x.pdf"], readInventory: async () => [] }), /upload method/i);
  await assert.rejects(store.consumeAsync({ authorizationId, operation: "upload", uploadMode: "api", names: ["x.pdf"], readInventory: async () => [] }), /already used|not found/i);
});

test("native CLI upload does not read the visible API method or cached API rows", () => {
  const source = readFileSync(require.resolve("../extension/content.js"), "utf8");
  assert.match(source, /options\.uploadMode \|\| \(options\.fromBridge \? "native" : uploadMode\)/);
  const nativeBlock = source.match(/async function startUpload\(options = \{\}\) \{([\s\S]*?)\n  async function startApiUpload/)?.[1] || "";
  assert.match(nativeBlock, /classifyUploads\(sourceFiles, readNativeRows\(\)\)/);
  assert.match(nativeBlock, /readNativeRows\(\)\.some\(\(row\) => row\.filename === file\.name\)/);
});
