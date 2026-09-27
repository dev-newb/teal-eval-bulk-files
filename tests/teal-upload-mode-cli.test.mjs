import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyPlan, classifyCommandResult, createPlan, inspectUploadFiles, parseArguments, verifyFiles } from "../extension/teal-eval-bulk-cli.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = join(root, "extension", "teal-eval-bulk-cli.mjs");
const proxyPath = join(root, "tests", "fake-persistent-proxy.mjs");
const wrapperPath = join(root, "skill", "scripts", "invoke-teal-cli.ps1");

function runProcess(program, args, env = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(program, args, {
      cwd: root,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectRun);
    child.once("exit", (code) => resolveRun({ code, stdout, stderr, json: JSON.parse(stdout.trim()) }));
  });
}

function directClient(file, { failTerminalList = false, terminalResult = null, stagedInitially = false, postApplyInventory = null } = {}) {
  const bridgeCommands = [];
  const row = { filename: file.filename, sha256: file.sha256, sizeText: `${file.size} B` };
  let applied = false;
  return {
    mode: "direct",
    targetId: "target_7",
    targetUrl: "http://127.0.0.1:8769/issue/TAB-TEST",
    targetTitle: "TAB-TEST local fixture",
    documentId: "",
    sessionId: null,
    bridgeCommands,
    async request(method, params) {
      if (method === "DOM.getDocument") {
        return { root: { children: [{ nodeName: "INPUT", nodeId: 44, attributes: ["class", "cli-bridge-upload"] }] } };
      }
      if (method === "DOM.setFileInputFiles") {
        assert.equal(params.files.length, 1);
        return {};
      }
      assert.equal(method, "Runtime.callFunctionOn");
      const command = params.arguments[0].value;
      bridgeCommands.push(command);
      if (command.command === "list") {
        if (applied && failTerminalList) return { result: { value: { ok: false, error: "API list unavailable" } } };
        return { result: { value: { ok: true, inventory: applied ? (postApplyInventory || [row]) : stagedInitially ? [row] : [] } } };
      }
      if (command.command === "prepare-upload") return { result: { value: { ok: true } } };
      if (command.command === "plan-upload") {
        return { result: { value: {
          ok: true, uploadMode: "api", requestedNames: command.names, actionableNames: command.names,
          inventory: [], authorizationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        } } };
      }
      if (command.command === "apply-upload") {
        applied = true;
        return { result: { value: terminalResult || {
          ok: true, operation: "upload", succeeded: [file.filename], skipped: [], failed: [], remaining: [],
          inventory: [] // The CLI must replace this old inventory with a fresh API list.
        } } };
      }
      throw new Error(`Unexpected command: ${command.command}`);
    }
  };
}

test("parser accepts upload mode only for upload and inventory commands", () => {
  const common = ["--cdp", "http://127.0.0.1:9222", "--issue", "TAB-TEST"];
  assert.equal(parseArguments([...common, "--upload-mode", "api", "list"]).uploadMode, "api");
  assert.equal(parseArguments([...common, "--upload-mode", "native", "apply-upload", "token"]).uploadMode, "native");
  assert.equal(parseArguments([...common, "apply-upload", "token"]).uploadMode, "");
  assert.throws(() => parseArguments([...common, "--upload-mode", "API", "list"]), /native or api/u);
  assert.throws(() => parseArguments([...common, "--upload-mode", "api", "status"]), /only with list/u);
  assert.throws(() => parseArguments([...common, "--upload-mode", "api", "plan-delete", "x"]), /only with list/u);
});

test("direct API plan binds mode; mismatch does not consume; implicit apply uses fresh terminal API inventory", { concurrency: false }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "teal-api-direct-mode-"));
  try {
    const path = join(temp, "new-file.txt");
    const statePath = join(temp, "tokens.json");
    await writeFile(path, "authorized bytes", "utf8");
    const [file] = await inspectUploadFiles([path]);
    const client = directClient(file);
    const common = { issueIdentifier: "TAB-TEST", statePath };
    const plan = await createPlan({ ...common, command: "plan-upload", operands: [path], uploadMode: "api", ttlMs: 60_000 }, client, 9);
    assert.equal(plan.uploadMode, "api");
    assert.deepEqual(client.bridgeCommands, [{ command: "list", uploadMode: "api" }]);
    let record = JSON.parse(await readFile(statePath, "utf8")).tokens[plan.token];
    assert.equal(record.uploadMode, "api");
    await assert.rejects(
      () => applyPlan({ ...common, command: "apply-upload", operands: [plan.token], uploadMode: "native" }, client, 9),
      /does not match the plan token/u
    );
    assert.equal(client.bridgeCommands.length, 1);
    record = JSON.parse(await readFile(statePath, "utf8")).tokens[plan.token];
    assert.equal(record.consumed, false);

    const applied = await applyPlan({ ...common, command: "apply-upload", operands: [plan.token] }, client, 9);
    assert.equal(applied.ok, true);
    assert.equal(applied.uploadMode, "api");
    assert.deepEqual(applied.succeeded, [file.filename]);
    assert.deepEqual(applied.skipped, []);
    assert.deepEqual(applied.failed, []);
    assert.deepEqual(applied.remaining, []);
    assert.deepEqual(applied.inventory, [{ filename: file.filename, sha256: file.sha256, sizeText: `${file.size} B` }]);
    const transferCommands = client.bridgeCommands.slice(1);
    assert.deepEqual(transferCommands.map((command) => command.command), ["list", "prepare-upload", "list", "plan-upload", "apply-upload", "list"]);
    assert.equal(transferCommands.every((command) => command.uploadMode === "api"), true);
    await assert.rejects(
      () => applyPlan({ ...common, command: "apply-upload", operands: [plan.token] }, client, 9),
      /already used/u
    );
    assert.equal(client.bridgeCommands.filter((command) => command.command === "apply-upload").length, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("API terminal list failure is indeterminate and never uses plan inventory as poststate", { concurrency: false }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "teal-api-list-failure-"));
  try {
    const path = join(temp, "new-file.txt");
    const statePath = join(temp, "tokens.json");
    await writeFile(path, "authorized bytes", "utf8");
    const [file] = await inspectUploadFiles([path]);
    const client = directClient(file, { failTerminalList: true });
    const common = { issueIdentifier: "TAB-TEST", statePath };
    const plan = await createPlan({ ...common, command: "plan-upload", operands: [path], uploadMode: "api", ttlMs: 60_000 }, client, 9);
    const applied = await applyPlan({ ...common, command: "apply-upload", operands: [plan.token] }, client, 9);
    assert.equal(applied.ok, false);
    assert.equal(applied.indeterminate, true);
    assert.equal(applied.tokenConsumed, true);
    assert.equal(applied.uploadMode, "api");
    assert.equal(applied.inventory, null);
    assert.deepEqual(applied.succeeded, [file.filename]);
    assert.deepEqual(applied.skipped, []);
    assert.deepEqual(applied.failed, []);
    assert.deepEqual(applied.remaining, []);
    assert.deepEqual(applied.uploadedBeforeFailure, []);
    assert.equal(client.bridgeCommands.filter((command) => command.command === "apply-upload").length, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("API verify uses API list and a failed API apply reports fresh post-error inventory", { concurrency: false }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "teal-api-reconcile-"));
  try {
    const path = join(temp, "reconcile.txt");
    const statePath = join(temp, "tokens.json");
    await writeFile(path, "reconcile bytes", "utf8");
    const [file] = await inspectUploadFiles([path]);
    const staged = directClient(file, { stagedInitially: true });
    const verified = await verifyFiles({ operands: [path], uploadMode: "api" }, staged, 9);
    assert.equal(verified.ok, true);
    assert.equal(verified.uploadMode, "api");
    assert.deepEqual(staged.bridgeCommands, [{ command: "list", uploadMode: "api" }]);

    const failedResult = { ok: false, operation: "upload", succeeded: [], skipped: [],
      failed: [{ name: file.filename, error: "registration reply lost" }], remaining: [file.filename], inventory: [] };
    const client = directClient(file, { terminalResult: failedResult });
    const common = { issueIdentifier: "TAB-TEST", statePath };
    const plan = await createPlan({ ...common, command: "plan-upload", operands: [path], uploadMode: "api", ttlMs: 60_000 }, client, 9);
    const applied = await applyPlan({ ...common, command: "apply-upload", operands: [plan.token] }, client, 9);
    assert.equal(applied.ok, false);
    assert.equal(applied.indeterminate, true);
    assert.equal(applied.uploadMode, "api");
    assert.deepEqual(applied.failed, failedResult.failed);
    assert.deepEqual(applied.remaining, failedResult.remaining);
    assert.deepEqual(applied.uploadedBeforeFailure, [file.filename]);
    assert.deepEqual(applied.inventory, [{ filename: file.filename, sha256: file.sha256, sizeText: `${file.size} B` }]);
    assert.equal(client.bridgeCommands.filter((command) => command.command === "apply-upload").length, 1);
    assert.equal(client.bridgeCommands.filter((command) => command.command === "list").every((command) => command.uploadMode === "api"), true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("API success with a same-name duplicate is uncertain and cannot be replayed", { concurrency: false }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "teal-api-duplicate-poststate-"));
  try {
    const path = join(temp, "duplicate.txt");
    const statePath = join(temp, "tokens.json");
    await writeFile(path, "authorized duplicate test bytes", "utf8");
    const [file] = await inspectUploadFiles([path]);
    const rows = [
      { filename: file.filename, sha256: file.sha256, sizeText: `${file.size} B` },
      { filename: file.filename, sha256: "f".repeat(64), sizeText: `${file.size} B` }
    ];
    const client = directClient(file, { postApplyInventory: rows });
    const common = { issueIdentifier: "TAB-TEST", statePath };
    const plan = await createPlan({ ...common, command: "plan-upload", operands: [path], uploadMode: "api", ttlMs: 60_000 }, client, 9);
    const applied = await applyPlan({ ...common, command: "apply-upload", operands: [plan.token] }, client, 9);
    assert.equal(applied.ok, false);
    assert.equal(applied.indeterminate, true);
    assert.equal(applied.tokenConsumed, true);
    assert.equal(applied.uploadMode, "api");
    assert.deepEqual(applied.succeeded, [file.filename]);
    assert.deepEqual(applied.failed, []);
    assert.deepEqual(applied.remaining, []);
    assert.deepEqual(applied.uploadedBeforeFailure, []);
    assert.equal(applied.inventory.length, 2);
    assert.equal(classifyCommandResult("apply-upload", "TAB-TEST", applied).exitCode, 4);
    await assert.rejects(
      () => applyPlan({ ...common, command: "apply-upload", operands: [plan.token] }, client, 9),
      /already used/u
    );
    assert.equal(client.bridgeCommands.filter((command) => command.command === "apply-upload").length, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("persistent API command shapes and wrapper forwarding keep the same mode", { concurrency: false }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "teal-api-persistent-mode-"));
  try {
    const path = join(temp, "persistent-new.txt");
    const statePath = join(temp, "tokens.json");
    const fakeState = join(temp, "proxy-state.json");
    const env = { TEAL_FAKE_MCP_STATE: fakeState };
    await writeFile(path, "persistent authorized bytes", "utf8");
    const common = ["--persistent-bridge", proxyPath, "--issue", "TAB-TEST", "--state", statePath];
    const list = await runProcess(process.execPath, [cliPath, ...common, "--upload-mode", "api", "list"], env);
    assert.equal(list.code, 0, list.stderr);
    assert.equal(list.json.uploadMode, "api");
    assert.deepEqual(list.json.inventory, []);
    const plan = await runProcess(process.execPath, [cliPath, ...common, "--upload-mode", "api", "plan-upload", path], env);
    assert.equal(plan.code, 0, plan.stderr);
    assert.equal(plan.json.uploadMode, "api");
    const mismatch = await runProcess(process.execPath, [cliPath, ...common, "--upload-mode", "native", "apply-upload", plan.json.token], env);
    assert.equal(mismatch.code, 4, mismatch.stderr);
    assert.match(mismatch.json.error, /does not match the plan token/u);
    const applied = await runProcess(process.execPath, [cliPath, ...common, "apply-upload", plan.json.token], env);
    assert.equal(applied.code, 0, applied.stderr);
    assert.equal(applied.json.uploadMode, "api");
    assert.deepEqual(applied.json.succeeded, ["persistent-new.txt"]);
    assert.equal(applied.json.inventory.some((row) => row.filename === "persistent-new.txt" && row.sha256 === plan.json.actionableFiles[0].sha256), true);
    const state = JSON.parse(await readFile(fakeState, "utf8"));
    assert.equal(state.inventory.some((row) => row.filename === "persistent-new.txt"), false);
    assert.equal(state.apiInventory.some((row) => row.filename === "persistent-new.txt"), true);
    const commands = state.commandEnvelopes.map((item) => item.command);
    assert.equal(commands.filter((command) => command.command === "apply-upload").length, 1);
    for (const command of commands.filter((item) => ["list", "prepare-upload", "plan-upload", "apply-upload"].includes(item.command))) {
      assert.equal(command.uploadMode, "api");
    }
    assert.equal(state.uploadedFiles.length, 1);
    const replay = await runProcess(process.execPath, [cliPath, ...common, "apply-upload", plan.json.token], env);
    assert.equal(replay.code, 4, replay.stderr);
    assert.match(replay.json.error, /already used/u);

    if (process.platform === "win32") {
      const wrapper = await runProcess("powershell.exe", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapperPath,
        "-PersistentBridgePath", proxyPath, "-Issue", "TAB-TEST", "-ExtensionRoot", join(root, "extension"),
        "-StatePath", statePath, "-Command", "list", "-UploadMode", "api"
      ], env);
      assert.equal(wrapper.code, 0, wrapper.stderr);
      assert.equal(wrapper.json.uploadMode, "api");
      const updated = JSON.parse(await readFile(fakeState, "utf8"));
      assert.equal(updated.commandEnvelopes.at(-1).command.uploadMode, "api");
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
