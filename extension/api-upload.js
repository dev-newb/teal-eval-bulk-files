(() => {
  "use strict";

  const ISSUE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
  const SHA256 = /^[0-9a-f]{64}$/i;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const PRODUCTION_ORIGIN = "https://platform-teal-alpha.vercel.app";
  const METADATA_TIMEOUT_MS = 60_000;
  const WRITE_POST_TIMEOUT_MS = 10 * 60_000;
  const BATCH_TIMEOUT_MS = 2 * 60 * 60_000;
  const RECONCILE_WINDOW_MS = 120_000;
  const RECONCILE_INTERVAL_MS = 2_000;
  // A copied test extension may replace only this port. Never allow other loopback pages.
  const FIXTURE_ORIGIN = "http://127.0.0.1:8769";

  class ApiUploadError extends Error {
    constructor(code, message, indeterminate = false, { stage = "", reason = "" } = {}) {
      super(message);
      this.name = "ApiUploadError";
      this.code = code;
      this.indeterminate = indeterminate;
      this.stage = stage || code.split("_")[0];
      this.reason = reason || "validation";
    }
  }

  function fail(code, message, indeterminate = false, details = {}) {
    throw new ApiUploadError(code, message, indeterminate, details);
  }

  function safeName(name) {
    return typeof name === "string" && name.length > 0 && name.length <= 240 && name !== "." && name !== ".." && !/[\\/\u0000-\u001f]/u.test(name);
  }

  function validateOrigin(origin, issueIdentifier) {
    if (!ISSUE.test(issueIdentifier || "")) fail("issue", "The API upload issue identifier was invalid.");
    if (origin === PRODUCTION_ORIGIN) return { fixture: false };
    if (origin === FIXTURE_ORIGIN && issueIdentifier === "TAB-TEST") return { fixture: true };
    fail("origin", "Direct API upload is not allowed on this page origin.");
  }

  function validateRows(payload) {
    if (!payload || typeof payload !== "object" || payload.error || !Array.isArray(payload.rows)) {
      fail("list_schema", "The staged-file API returned an invalid inventory.");
    }
    return payload.rows.map((row) => {
      if (!row || typeof row !== "object" || !safeName(row.filename) || !SHA256.test(row.sha256 || "") ||
          !Number.isSafeInteger(row.byte_size) || row.byte_size < 0) {
        fail("list_schema", "The staged-file API returned an invalid inventory row.");
      }
      return { filename: row.filename, sha256: row.sha256.toLowerCase(), byte_size: row.byte_size };
    });
  }

  function publicInventory(rows) {
    return rows.map((row) => ({ filename: row.filename, sha256: row.sha256, sizeText: String(row.byte_size) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en-US"));
  }

  function validateDestination(payload, issueIdentifier, filename, fixture) {
    if (!payload || typeof payload !== "object" || payload.error || typeof payload.upload_url !== "string" ||
        typeof payload.storage_key !== "string" || typeof payload.bucket !== "string" ||
        typeof payload.region !== "string") {
      fail("prepare_schema", "The API did not return a valid upload destination.");
    }
    const { storage_key: key, bucket, region } = payload;
    const parts = key.split("/");
    if (parts.length !== 3 || parts[0] !== issueIdentifier || !UUID.test(parts[1]) || parts[2] !== filename ||
        !/^[a-z0-9][a-z0-9.-]{2,62}$/u.test(bucket) || !/^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]$/u.test(region)) {
      fail("prepare_schema", "The API returned an upload destination that did not match this file.");
    }
    let url;
    try { url = new URL(payload.upload_url); } catch { fail("destination", "The API returned an invalid upload URL."); }
    if (url.username || url.password || url.hash) fail("destination", "The API returned an unsafe upload URL.");
    if (fixture) {
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { fail("destination", "The test upload URL path was invalid."); }
      if (url.origin !== FIXTURE_ORIGIN || path !== `/mock-upload/${key}` || url.search) {
        fail("destination", "The test upload URL did not match the prepared file.");
      }
      return url.href;
    }
    if (url.protocol !== "https:" || url.port) fail("destination", "The upload URL must use the expected HTTPS storage service.");
    const virtualHosts = new Set([`${bucket}.s3.${region}.amazonaws.com`, `${bucket}.s3-${region}.amazonaws.com`]);
    const isVirtual = virtualHosts.has(url.hostname);
    const isPathStyle = url.hostname === `s3.${region}.amazonaws.com`;
    let decodedPath;
    try { decodedPath = decodeURIComponent(url.pathname); } catch { fail("destination", "The signed upload URL path was invalid."); }
    if ((!isVirtual && !isPathStyle) ||
        decodedPath !== (isVirtual ? `/${key}` : `/${bucket}/${key}`)) {
      fail("destination", "The signed upload URL did not match the prepared storage key.");
    }
    const credential = url.searchParams.get("X-Amz-Credential") || "";
    if (url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
        !SHA256.test(url.searchParams.get("X-Amz-Signature") || "") ||
        !credential.includes(`/${region}/s3/aws4_request`) ||
        !/^\d{8}T\d{6}Z$/u.test(url.searchParams.get("X-Amz-Date") || "") ||
        !/^\d{1,5}$/u.test(url.searchParams.get("X-Amz-Expires") || "")) {
      fail("destination", "The upload URL was not a valid signed S3 PUT destination.");
    }
    return url.href;
  }

  function createClient({ origin, issueIdentifier, fetchImpl = fetch, isCurrent = () => true,
    now = () => Date.now(), deadline = Infinity, recordPartial = async () => {}, onStage = () => {},
    timeoutSignal = (ms) => AbortSignal.timeout(ms), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    reconciliationWindowMs = RECONCILE_WINDOW_MS }) {
    const { fixture } = validateOrigin(origin, issueIdentifier);
    if (typeof fetchImpl !== "function" || typeof isCurrent !== "function" || typeof recordPartial !== "function" ||
        typeof onStage !== "function" || typeof timeoutSignal !== "function" || typeof sleep !== "function" ||
        !Number.isSafeInteger(reconciliationWindowMs) || reconciliationWindowMs < 1 || reconciliationWindowMs > RECONCILE_WINDOW_MS) {
      fail("client", "The API upload client settings were invalid.");
    }
    const initialUrl = `${origin}/issue/${issueIdentifier}`;

    function checkCurrent() {
      if (!isCurrent() || now() >= deadline) fail("stopped", "The page changed or the upload deadline passed. No later file was started.", true);
    }

    async function request(url, options, code, message, timeoutCapMs = METADATA_TIMEOUT_MS) {
      checkCurrent();
      const remaining = Number.isFinite(deadline) ? deadline - now() : BATCH_TIMEOUT_MS;
      const timeoutMs = Math.max(1, Math.min(timeoutCapMs, remaining));
      let response;
      try {
        response = await fetchImpl(url, { ...options, redirect: "error", signal: timeoutSignal(timeoutMs) });
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        fail(code, timedOut ? `${message} The ${code.split("_")[0]} request timed out.` : message,
          code === "register_response", { reason: timedOut ? "timeout" : "network" });
      }
      if (response.redirected || response.url !== url || !response.ok) {
        fail(code, message, code === "register_response", { reason: response.redirected ? "redirect" : "http" });
      }
      checkCurrent();
      return response;
    }

    async function json(response, code, message) {
      try { return await response.json(); } catch { fail(code, message, code === "register_response"); }
    }

    async function list(timeoutCapMs = METADATA_TIMEOUT_MS) {
      const url = `${origin}/api/staged-files?issue_identifier=${encodeURIComponent(issueIdentifier)}`;
      const response = await request(url, { method: "GET", credentials: "include", cache: "no-store", headers: { Accept: "application/json" } },
        "list_http", "The staged-file API could not provide a fresh inventory. Check your login and try a new plan.", timeoutCapMs);
      return validateRows(await json(response, "list_schema", "The staged-file API returned invalid JSON."));
    }

    async function uploadOne(file) {
      checkCurrent();
      if (!file || !safeName(file.name) || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.arrayBuffer !== "function") {
        fail("file", "The selected upload file was invalid.");
      }
      const before = await list();
      if (before.some((row) => row.filename === file.name)) return { skipped: true, reason: "already staged - skipped", rows: before };
      onStage("hashing", file.name);
      const bytes = await file.arrayBuffer();
      checkCurrent();
      if (bytes.byteLength !== file.size) fail("file", "The selected file changed while it was read.");
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const contentType = file.type || "application/octet-stream";
      onStage("preparing", file.name);
      const prepareUrl = `${origin}/api/storage/staged-upload-url`;
      const prepareResponse = await request(prepareUrl, {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ issue_identifier: issueIdentifier, filename: file.name, content_type: contentType })
      }, "prepare_http", "The staged-file API did not prepare an upload. Check your login; no file was transferred.", WRITE_POST_TIMEOUT_MS);
      const prepared = await json(prepareResponse, "prepare_schema", "The API returned invalid upload preparation JSON.");
      const destination = validateDestination(prepared, issueIdentifier, file.name, fixture);
      checkCurrent();
      const partial = { issueIdentifier, filename: file.name, storageKey: prepared.storage_key,
        sha256: hash, byteSize: file.size, page: initialUrl, recordedAt: now() };
      await recordPartial({ ...partial, phase: "prepared" });
      onStage("transferring", file.name);
      const putResponse = await request(destination, {
        method: "PUT", credentials: "omit", cache: "no-store", headers: { "Content-Type": contentType }, body: file
      }, "put_http", "The storage PUT was not confirmed. An unregistered object may remain; no registration was attempted.", BATCH_TIMEOUT_MS);
      if (!putResponse) fail("put_http", "The storage PUT was not confirmed.");
      await recordPartial({ ...partial, phase: "put_confirmed" });
      checkCurrent();
      onStage("registering", file.name);
      const registerUrl = `${origin}/api/staged-files`;
      let registerConfirmed = false;
      let registerIssue = "";
      try {
        const response = await request(registerUrl, {
          method: "POST", credentials: "include", cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ issue_identifier: issueIdentifier, filename: file.name,
            storage_key: prepared.storage_key, content_type: contentType })
        }, "register_response", "The registration response was lost or invalid. No registration retry was attempted.", WRITE_POST_TIMEOUT_MS);
        const payload = await json(response, "register_response", "The registration response was invalid. No registration retry was attempted.");
        registerConfirmed = Boolean(!payload?.error && payload?.row && payload.row.filename === file.name &&
          payload.row.sha256 === hash && payload.row.byte_size === file.size);
        if (!registerConfirmed) registerIssue = "invalid_response";
      } catch (error) {
        if (error?.code === "stopped") throw error;
        registerIssue = error?.reason || "lost_response";
      }
      await recordPartial({ ...partial, phase: registerConfirmed ? "registered_unverified" : "registration_uncertain" });
      onStage("verifying", file.name);
      let after;
      const reconcileUntil = Math.min(now() + reconciliationWindowMs, deadline);
      let lastReadError = false;
      const failReconciliation = () => {
        const detail = registerIssue === "timeout" ? " after the registration request timed out" : "";
        fail("verify", `The server did not confirm the registered file${detail} during bounded read-only checks. Do not retry registration.`, true,
          { stage: "reconcile", reason: lastReadError ? "inventory_unavailable" : (registerIssue || "not_visible") });
      };
      while (true) {
        try {
          after = await list(Math.max(1, Math.min(METADATA_TIMEOUT_MS, reconcileUntil - now())));
          lastReadError = false;
        } catch (error) {
          if (error?.code === "stopped") throw error;
          lastReadError = true;
          after = null;
        }
        if (after) {
          const hits = after.filter((row) => row.filename === file.name);
          if (hits.length > 1 || (hits.length === 1 && (hits[0].sha256 !== hash || hits[0].byte_size !== file.size))) {
            fail("verify", "The server returned a duplicate or mismatched file. Do not retry registration.", true,
              { stage: "reconcile", reason: hits.length > 1 ? "duplicate" : "hash_or_size_mismatch" });
          }
          if (hits.length === 1) break;
        }
        if (now() >= reconcileUntil) failReconciliation();
        onStage("reconciling", file.name);
        await sleep(Math.min(RECONCILE_INTERVAL_MS, reconcileUntil - now()));
        checkCurrent();
        if (now() >= reconcileUntil) failReconciliation();
      }
      await recordPartial({ ...partial, phase: "verified" });
      return { rows: after, sha256: hash, byteSize: file.size, reconciled: !registerConfirmed };
    }

    return Object.freeze({ list, uploadOne, publicInventory });
  }

  globalThis.TealEvalApiUpload = Object.freeze({ createClient, validateDestination, validateRows, publicInventory, ApiUploadError });
})();
