#!/usr/bin/env node
// Capture the real extension UI against a fictional local page and a fake API.
// Only the copied test extension gets loopback, open-shadow, and terminal hooks.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "extension");
const imagesRoot = resolve(root, "docs", "images");
const receiptsRoot = resolve(root, "artifacts", "documentation-capture");
const fixturePath = resolve(root, "tests", "mock", "issue", "TAB-TEST", "index.html");
const issueIdentifier = "DEMO-204";
const demoFiles = [
  ["demo_sensor_layout.csv", Buffer.from("layout")],
  ["demo_calibration_notes.txt", Buffer.from("calibration")],
  ["demo_trial_summary.md", Buffer.from("summary")],
  ["demo_sample_manifest.json", Buffer.from("manifest")]
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const initialRows = demoFiles.map(([filename, bytes]) => ({ id: randomUUID(), filename, byte_size: bytes.length, sha256: digest(bytes), bytes }));
const rows = [...initialRows];
const uploadedObjects = new Map();
const receipts = [];
const note = (name, action, source, extra = {}) => receipts.push({ name, action, source, fictionalDemo: true, ...extra });
let origin = "";
let context;
let temporary;
let captureError;
const server = createServer(async (request, response) => {
  const json = (status, value) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  };
  const send = (status, bytes, type) => {
    response.writeHead(status, { "content-type": type, "content-length": bytes.length, "cache-control": "no-store" });
    response.end(bytes);
  };
  try {
    const url = new URL(request.url, origin || "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === `/issue/${issueIdentifier}`) {
      send(200, Buffer.from(demoHtml), "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/staged-files") {
      assert.equal(url.searchParams.get("issue_identifier"), issueIdentifier);
      json(200, { rows: rows.map(({ bytes, ...row }) => row) });
      return;
    }
    if (request.method === "GET" && /^\/api\/staged-files\/[^/]+\/download-url$/.test(url.pathname)) {
      const id = url.pathname.split("/")[3];
      assert.ok(rows.some((row) => row.id === id));
      json(200, { download_url: `${origin}/mock-downloads/${id}` });
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/mock-downloads/")) {
      const row = rows.find((entry) => entry.id === url.pathname.split("/").at(-1));
      assert.ok(row);
      await new Promise((done) => setTimeout(done, 900));
      send(200, row.bytes, "application/octet-stream");
      return;
    }
    if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    const parts = [];
    for await (const part of request) parts.push(part);
    const bytes = Buffer.concat(parts);
    if (request.method === "POST" && url.pathname === "/api/storage/staged-upload-url") {
      const body = JSON.parse(bytes);
      assert.equal(body.issue_identifier, issueIdentifier);
      assert.equal(typeof body.filename, "string");
      const key = `${issueIdentifier}/${randomUUID()}/${body.filename}`;
      uploadedObjects.set(key, { filename: body.filename, type: body.content_type });
      json(200, { upload_url: `${origin}/mock-upload/${key.split("/").map(encodeURIComponent).join("/")}`,
        storage_key: key, bucket: "demo-bucket", region: "us-east-1" });
      return;
    }
    if (request.method === "PUT" && url.pathname.startsWith("/mock-upload/")) {
      const key = decodeURIComponent(url.pathname.slice("/mock-upload/".length));
      const entry = uploadedObjects.get(key);
      assert.ok(entry);
      entry.bytes = bytes;
      await new Promise((done) => setTimeout(done, 700));
      response.writeHead(200); response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/staged-files") {
      const body = JSON.parse(bytes);
      assert.equal(body.issue_identifier, issueIdentifier);
      const entry = uploadedObjects.get(body.storage_key);
      assert.ok(entry?.bytes);
      const row = { id: randomUUID(), filename: entry.filename, byte_size: entry.bytes.length,
        sha256: digest(entry.bytes), bytes: entry.bytes };
      rows.push(row);
      json(200, { row: { id: row.id, filename: row.filename, byte_size: row.byte_size, sha256: row.sha256 } });
      return;
    }
    json(404, { error: "Unknown fictional fixture route." });
  } catch (error) {
    json(500, { error: `Fictional fixture failed: ${error instanceof Error ? error.message : String(error)}` });
  }
});

function replaceExactly(source, find, replacement, label) {
  assert.ok(source.includes(find), `${label} was not found in the disposable copy`);
  return source.replace(find, replacement);
}

async function prepareCopiedExtension(destination) {
  await cp(extensionRoot, destination, { recursive: true });
  const manifestPath = join(destination, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.name = "Teal Eval Bulk Files · fictional demo";
  manifest.host_permissions = [`${origin}/*`];
  manifest.content_scripts = manifest.content_scripts.map((entry) => ({ ...entry, matches: [`${origin}/issue/*`] }));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const contentPath = join(destination, "content.js");
  await writeFile(contentPath, replaceExactly(await readFile(contentPath, "utf8"),
    'host.attachShadow({ mode: "closed" })', 'host.attachShadow({ mode: "open" })', "shadow root"));

  const apiPath = join(destination, "api-upload.js");
  let api = await readFile(apiPath, "utf8");
  api = replaceExactly(api, 'const FIXTURE_ORIGIN = "http://127.0.0.1:8769";',
    `const FIXTURE_ORIGIN = "${origin}";`, "API fixture origin");
  api = replaceExactly(api, 'issueIdentifier === "TAB-TEST"', `issueIdentifier === "${issueIdentifier}"`, "API fixture issue");
  await writeFile(apiPath, api);

  // A headless browser has no user Save As dialog. This local-copy hook sends
  // the same terminal event that the real browser download listener sends.
  const backgroundPath = join(destination, "background.js");
  let background = await readFile(backgroundPath, "utf8");
  background = replaceExactly(background,
    "const downloadId = await startSaveAs(message.blobUrl, message.archiveFilename);",
    "const downloadId = 204; // fictional headless terminal fixture; no OS Save As", "Save As fixture");
  background = replaceExactly(background, "checkTerminalState(downloadId);",
    'setTimeout(() => { void notifyTerminal(downloadId, message.entries.length === 2 ? "interrupted" : "complete", "The browser cancelled the Save As request in this fictional demo."); }, 800);', "download terminal fixture");
  await writeFile(backgroundPath, background);
}

async function chooseChromium() {
  const candidate = process.env.PLAYWRIGHT_CHROMIUM_PATH || chromium.executablePath();
  await access(candidate, fsConstants.X_OK);
  return candidate;
}

const viewport = { width: 1500, height: 900 };
const panelClip = { x: 300, y: 22, width: 900, height: 856 };
let page;
let host;
async function capture(name, action, source = "real extension UI", fullPage = false) {
  const path = join(imagesRoot, name);
  const bytes = await page.screenshot({ path, ...(fullPage ? { fullPage: true } : { clip: panelClip }), animations: "disabled" });
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.ok(width >= 700 && height >= 400, `${name} is too small to read`);
  const status = host ? await host.locator(".status").textContent().catch(() => "") : "";
  note(name, action, source, { width, height, status: status?.trim() || "" });
  process.stdout.write(`Captured ${name} (${width}x${height})\n`);
}

async function newPage(query = "") {
  await page.goto(`${origin}/issue/${issueIdentifier}${query}`, { waitUntil: "domcontentloaded" });
  await page.locator("#teal-eval-bulk-files-v1-button").waitFor({ state: "visible", timeout: 15000 });
  host = page.locator("#teal-eval-bulk-files-v1-host");
}

async function openPanel(tab = "upload") {
  await page.locator("#teal-eval-bulk-files-v1-button").click();
  await host.locator(".backdrop.open").waitFor({ state: "visible" });
  if (tab !== "upload") await host.locator(`.tab[data-tab="${tab}"]`).click();
}

async function selectUpload(files) {
  await host.locator(".bulk-input").setInputFiles(files.map(([name, value]) => ({ name,
    mimeType: name.endsWith(".csv") ? "text/csv" : "text/plain", buffer: Buffer.from(value) })));
  await host.locator(".upload-ack").check();
}

const uploadSelection = [
  ["candidate_thresholds.csv", "zone,limit\nA,72\n"],
  ["sensor_review_notes.txt", "Fictional sensor review notes.\n"],
  ["demo_sensor_layout.csv", "Already staged duplicate.\n"]
];

async function captureUploadScreens() {
  await newPage();
  await openPanel();
  await capture("upload-empty.png", "Open Upload with no file selected");
  await selectUpload(uploadSelection);
  await capture("upload-mode.png", "Choose two new files and one staged duplicate; acknowledge one Linear comment per finalized file");
  await host.locator(".upload").click();
  await host.locator(".confirm-backdrop.open").waitFor();
  await capture("upload-confirmation.png", "Review the real native-upload confirmation dialog");
  await host.locator(".confirm-apply").click();
  try {
    await host.locator(".status").filter({ hasText: /Uploading 1 of 2/ }).waitFor({ timeout: 10000 });
  } catch (error) {
    process.stdout.write(`Native-upload diagnostic: ${JSON.stringify({ status: await host.locator('.status').textContent(), native: await page.locator('.staged').innerText(), selected: await host.locator('.file-list').innerText() })}\n`);
    throw error;
  }
  await capture("upload-progress.png", "Run the native page upload while the first file is in progress");
  await host.locator(".status.success").filter({ hasText: /Uploaded and finalized 2 files/ }).waitFor({ timeout: 30000 });
  await capture("upload-complete.png", "Observe two finalized uploads and one duplicate skip");

  await newPage();
  await openPanel();
  await selectUpload([["stop_one.csv", "one"], ["stop_two.csv", "two"], ["stop_three.csv", "three"]]);
  await host.locator(".upload").click();
  await host.locator(".confirm-apply").click();
  await host.locator(".status").filter({ hasText: /Uploading 1 of 3/ }).waitFor({ timeout: 10000 });
  await host.locator('.stop[data-stop-mode="upload"]').click();
  await host.locator(".status.success").filter({ hasText: /Stopped after 1 successful file/ }).waitFor({ timeout: 15000 });
  await capture("upload-stopped.png", "Stop after one completed native file; later files remain selected");

  await newPage("?failFirst=1");
  await openPanel();
  await selectUpload([["fault_example.csv", "fictional fault"]]);
  await host.locator(".upload").click();
  await host.locator(".confirm-apply").click();
  await host.locator(".status.error").filter({ hasText: /Failed to fetch/ }).waitFor({ timeout: 12000 });
  await capture("upload-error.png", "Show the real extension error state after the fictional native page returns Failed to fetch");
}

async function captureDownloadScreens() {
  await newPage();
  await openPanel("download");
  await host.locator(".download-select-all").click();
  await capture("download-mode.png", "Select four staged files for one ZIP");
  await host.locator(".start-download").click();
  await host.locator(".status").filter({ hasText: /Reading 1 of 4/ }).waitFor({ timeout: 10000 });
  await capture("download-progress.png", "Read the first staged file for a verified ZIP");
  await host.locator(".status.success").filter({ hasText: /Saved one ZIP with 4 files/ }).waitFor({ timeout: 25000 });
  await capture("download-complete.png", "Observe the real completion UI after a local fake browser terminal event", "real extension UI; fictional browser download terminal event");

  await newPage();
  await openPanel("download");
  await host.locator(".download-select-all").click();
  await host.locator(".start-download").click();
  await host.locator(".status").filter({ hasText: /Reading 1 of 4/ }).waitFor({ timeout: 10000 });
  await host.locator('.stop[data-stop-mode="download"]').click();
  await host.locator(".status.success").filter({ hasText: /Stopped while preparing the ZIP/ }).waitFor({ timeout: 12000 });
  await capture("download-stopped.png", "Stop ZIP preparation after the current file; no ZIP is saved");

  await newPage();
  await openPanel("download");
  await host.locator("[data-download-key]").first().check();
  await host.locator("[data-download-key]").nth(1).check();
  await host.locator(".start-download").click();
  await host.locator(".status.error").filter({ hasText: /The ZIP was not saved/ }).waitFor({ timeout: 16000 });
  await capture("download-cancelled.png", "Observe the real extension cancellation/error UI after a fictional interrupted browser Save As terminal event", "real extension UI; fictional browser Save As cancellation terminal event");
}

async function chooseDeleteTwo() {
  await host.locator(".tab[data-tab=delete]").click();
  await host.locator("[data-delete-key]").first().check();
  await host.locator("[data-delete-key]").nth(1).check();
}

async function captureDeleteScreens() {
  await newPage();
  await openPanel();
  await chooseDeleteTwo();
  await capture("delete-mode.png", "Select two exact staged rows for deletion");
  await host.locator(".delete").click();
  await host.locator(".confirm-backdrop.open").waitFor();
  await capture("delete-confirmation.png", "Review the exact deletion list and permanent-action warning");
  await host.locator(".confirm-apply").click();
  await host.locator(".status").filter({ hasText: /Deletion starts in 5 seconds/ }).waitFor({ timeout: 5000 });
  await capture("delete-countdown.png", "Show the real five-second stop window");
  await host.locator(".stop-delete").click();
  await host.locator(".status.success").filter({ hasText: /Deletion cancelled. Deleted 0 of 2/ }).waitFor({ timeout: 5000 });
  await capture("delete-stopped.png", "Stop during the grace window before any deletion");

  await newPage();
  await openPanel();
  await chooseDeleteTwo();
  await host.locator(".delete").click();
  await host.locator(".confirm-apply").click();
  await host.locator(".status").filter({ hasText: /Deleting 1 of 2/ }).waitFor({ timeout: 10000 });
  await capture("delete-progress.png", "Show the first active native deletion after the five-second grace period");
  await host.locator(".status.success").filter({ hasText: /Deleted 2 of 2/ }).waitFor({ timeout: 16000 });
  await capture("delete-complete.png", "Allow two exact native deletions to complete in the local page");
}

async function captureApiScreens() {
  await newPage();
  await openPanel();
  await host.locator(".upload-method").selectOption("api");
  await host.locator(".file-list").filter({ hasText: /Checking staged files with the API/ }).waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await selectUpload([["api_trial_log.csv", "trial,result\n1,review\n"], ["demo_sensor_layout.csv", "duplicate"]]);
  await host.locator(".upload").waitFor({ state: "visible" });
  await capture("upload-api-mode.png", "Select Direct API with one new file and one already-staged duplicate");
  await host.locator(".upload").click();
  await host.locator(".confirm-backdrop.open").waitFor();
  await capture("upload-api-confirmation.png", "Review the Direct API registration and Linear-comment confirmation dialog");
  await host.locator(".confirm-apply").click();
  await host.locator(".status").filter({ hasText: /Direct API upload.*api_trial_log.csv/ }).waitFor({ timeout: 10000 });
  await capture("upload-api-progress.png", "Transfer one fictional file through the Direct API and show the real progress state");
  await host.locator(".status.success").filter({ hasText: /Verified 1 Direct API upload/ }).waitFor({ timeout: 16000 });
  await capture("upload-api-complete.png", "Run prepare, transfer, register, and SHA-256/size verification against the local fake API");
}

async function captureCliExample() {
  const cliPage = await context.newPage();
  try {
    await cliPage.setViewportSize({ width: 1180, height: 760 });
    const example = [
      'PS> .\\skill\\scripts\\invoke-teal-cli.ps1 -PersistentBridgePath "<absolute-path-to-stdio-proxy.mjs>"',
      '    -Issue DEMO-204 -Command plan-upload -UploadMode api -Operands "C:\\demo\\trial_log.csv"',
      '{',
      '  "issueIdentifier": "DEMO-204",',
      '  "operation": "upload", "uploadMode": "api",',
      '  "inventory": [{"filename":"demo_sensor_layout.csv","sha256":"<fictional SHA-256>","sizeText":"6 B"}],',
      '  "actionableNames": ["trial_log.csv"],',
      '  "token": "<one-use-token>", "exitCode": 0',
      '}',
      '',
      'PS> .\\skill\\scripts\\invoke-teal-cli.ps1 -PersistentBridgePath "<absolute-path-to-stdio-proxy.mjs>"',
      '    -Issue DEMO-204 -Command apply-upload -PlanToken "<one-use-token>"',
      '{',
      '  "issueIdentifier": "DEMO-204", "operation": "upload", "uploadMode": "api",',
      '  "succeeded": ["trial_log.csv"], "skipped": [], "failed": [], "remaining": [],',
      '  "exitCode": 0',
      '}'
    ].join("\n");
    await cliPage.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:38px;background:#0e0e11;color:#e8e8ee;font:14px/1.55 ui-monospace,Consolas,monospace}
      .terminal{border:1px solid #34343d;border-radius:12px;background:#141419;box-shadow:0 18px 55px #0008;overflow:hidden}
      .bar{padding:12px 17px;background:#1c1c23;border-bottom:1px solid #34343d;color:#c1c1d0;font:600 14px Segoe UI,sans-serif}
      .warning{padding:9px 17px;color:#e9c47f;background:#2a2417;border-bottom:1px solid #4b3e24;font:13px Segoe UI,sans-serif}
      pre{margin:0;padding:21px 24px;white-space:pre-wrap;overflow-wrap:anywhere}
      </style><div class="terminal"><div class="bar">Teal Eval Bulk Files · agent command example</div>
      <div class="warning">Illustrative command and output · fictional issue, path, files, hash, and token</div><pre></pre></div>`);
    await cliPage.locator("pre").evaluate((node, text) => { node.textContent = text; }, example);
    const bytes = await cliPage.locator(".terminal").screenshot({ path: join(imagesRoot, "cli-plan-example.png") });
    note("cli-plan-example.png", "Show the current CLI plan/apply fields and a one-use-token handoff", "illustrative command/output; not a CLI execution", {
      width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)
    });
    process.stdout.write("Captured cli-plan-example.png (illustrative)\n");
  } finally { await cliPage.close(); }
}

async function captureInstallation() {
  const installPage = await context.newPage();
  try {
    await installPage.setViewportSize({ width: 1100, height: 700 });
    await installPage.goto("chrome://extensions", { waitUntil: "domcontentloaded", timeout: 10000 });
    await installPage.locator("extensions-manager").waitFor({ timeout: 10000 });
    const card = installPage.locator("extensions-item").filter({ hasText: "Teal Eval Bulk Files" });
    await card.waitFor({ timeout: 10000 });
    const developerToggle = installPage.locator("extensions-toolbar").locator("#devMode");
    if (await developerToggle.count()) {
      if (!(await developerToggle.evaluate((node) => Boolean(node.checked)))) await developerToggle.click();
    } else {
      await installPage.getByText("Developer mode", { exact: true }).click();
    }
    const loadUnpacked = installPage.getByText("Load unpacked", { exact: true });
    await loadUnpacked.waitFor({ state: "visible", timeout: 5000 });
    await loadUnpacked.scrollIntoViewIfNeeded();
    await installPage.waitForTimeout(500);
    const developerModeEnabled = await developerToggle.evaluate((node) => Boolean(node.checked)).catch(() => false);
    const bytes = await installPage.screenshot({ path: join(imagesRoot, "installation.png") });
    note("installation.png", "Show Load unpacked and the copied fictional extension as the only installed item in a new temporary Chromium profile", "real Chromium extension management UI", {
      width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), developerModeEnabled,
      loadUnpackedVisible: await loadUnpacked.isVisible(), loadUnpackedBox: await loadUnpacked.boundingBox()
    });
    process.stdout.write("Captured installation.png\n");
  } catch (error) {
    note("installation.png", "Optional extension-management card was not available in headless Chromium", "not captured", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.stdout.write("Skipped optional installation.png: headless management UI unavailable\n");
  } finally { await installPage.close(); }
}

let demoHtml = "";
try {
  const baseHtml = await readFile(fixturePath, "utf8");
  const demoHashEntries = demoFiles.map(([name, bytes]) => `            '${name}': '${digest(bytes)}',`).join("\n");
  demoHtml = replaceExactly(baseHtml, "const knownHashes = {", `const knownHashes = {\n${demoHashEntries}`, "fictional staged hashes");
  demoHtml = replaceExactly(demoHtml, "params.get('docs') === '1'", "true", "fictional docs rows");
  demoHtml = replaceExactly(demoHtml, '<div class="native-error"></div>',
    '<div class="native-error" style="color:var(--danger)"></div>', "visible native error surface");
  // Make in-progress states long enough to capture without changing production.
  demoHtml = demoHtml.replaceAll("}, 120);", "}, 650);");
  demoHtml = demoHtml.replaceAll("}, 260);", "}, 1200);");

  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  temporary = await mkdtemp(join(tmpdir(), "teal-doc-capture-"));
  assert.ok(resolve(temporary).startsWith(`${resolve(tmpdir())}${sep}`));
  const buildRoot = join(temporary, "extension");
  const profileRoot = join(temporary, "profile");
  await prepareCopiedExtension(buildRoot);
  await mkdir(imagesRoot, { recursive: true });
  const executablePath = await chooseChromium();
  context = await chromium.launchPersistentContext(profileRoot, {
    executablePath, headless: true, viewport, colorScheme: "dark", acceptDownloads: false,
    args: [
      `--disable-extensions-except=${buildRoot}`, `--load-extension=${buildRoot}`,
      "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
      "--disable-component-update", "--disable-sync", "--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1"
    ]
  });
  page = await context.newPage();
  page.on("pageerror", (error) => process.stdout.write(`Fictional page error: ${error.message}\n`));
  await newPage();
  await capture("eval-page-overview.png", "Show the complete fictional evaluation page, including question, rubric table, Expected Answer Table, staged files, and run history", "real page plus real extension button; all content fictional", true);
  await captureUploadScreens();
  await captureDownloadScreens();
  await captureDeleteScreens();
  await captureApiScreens();
  await captureCliExample();
  await captureInstallation();
} catch (error) {
  captureError = error;
  throw error;
} finally {
  if (context) await context.close();
  if (server.listening) await new Promise((done) => server.close(done));
  if (temporary) {
    assert.ok(resolve(temporary).startsWith(`${resolve(tmpdir())}${sep}`));
    await rm(temporary, { recursive: true, force: true });
  }
  await mkdir(receiptsRoot, { recursive: true });
  const receiptPath = join(receiptsRoot, `capture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(receiptPath, `${JSON.stringify({ version: "0.10.0", issueIdentifier,
    fixture: "fictional loopback page and API", osSaveAs: "terminal event simulated in disposable extension copy; no Save As screenshot",
    error: captureError ? String(captureError) : null, images: receipts }, null, 2)}\n`);
  process.stdout.write(`Capture receipt: ${receiptPath}\n`);
}
