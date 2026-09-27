# Teal Eval Bulk Files: user and agent manual

Version 0.10.0 · Chrome and Microsoft Edge · Windows CLI examples

Teal Eval Bulk Files adds bulk upload, ZIP download, and checked deletion to the **Staged files** area of a Tacit eval page. You can use its visible controls yourself, or give an agent access through the companion CLI shipped in the same package.

This manual uses a complete fictional eval page and invented files. Screenshots show the real extension controls running against a local demonstration service. Download completion and cancellation use simulated browser download results. No real task or account appears in the images.

## Contents

- [Quick start](#quick-start)
- [Install and update](#install-and-update)
- [The normal interface](#the-normal-interface)
- [Upload files](#upload-files)
- [Download files](#download-files)
- [Delete files](#delete-files)
- [Use the extension with an agent](#use-the-extension-with-an-agent)
- [Advanced: run the mjs CLI yourself](#advanced-run-the-mjs-cli-yourself)
- [Troubleshooting and limits](#troubleshooting-and-limits)
- [What stays running](#what-stays-running)

## Quick start

For normal use, load the extension in your browser, sign in to Tacit, and open the required task. Select **Bulk files** beside **Add file**.

| Goal | Select | Result |
| --- | --- | --- |
| Upload several files | Upload loose files | Files are uploaded one at a time; existing filenames are skipped |
| Download selected files | Download staged files | One verified ZIP and one browser Save As dialog |
| Delete selected files | Delete staged files | A filename review, confirmation, and five-second stop window |

Human use does not require Node.js, a terminal, or the persistent bridge. Those are for CLI access.

![Full fictional eval page with question, grading tables, staged files, and the Bulk files control](images/eval-page-overview.png)

The extension manages staged files. It does not fill the Question, Rubric, or Expected Answer Table and does not launch eval runs.

## Install and update

### First installation

1. Download or clone [the public repository](https://github.com/dev-newb/teal-eval-bulk-files).
2. If you downloaded a ZIP, extract it into a folder that you will keep.
3. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Select the package's **extension** folder. It contains `manifest.json`. Do not select the repository root or the ZIP itself.
7. Reload the Tacit task page. Find **Bulk files** in its **Staged files** area.

The browser keeps a reference to that folder. Do not move or delete it while the extension is installed.

![Chrome extension manager in the isolated demonstration profile](images/installation.png)

The extension name includes “fictional demo” only in the screenshots. Your normal installation is named **Teal Eval Bulk Files**.

### Update an existing installation

Replace the files in the same unpacked extension folder. In the browser's extension manager, select **Reload** on **Teal Eval Bulk Files**. Then refresh the eval page after saving any unfinished page edits. Wait for an active file operation to finish before reloading.

Update the companion CLI and skill together with the extension. Their exact version checks prevent an older CLI from sending commands that a newer extension interprets differently.

For command-line use, the supported combination in this manual is extension/CLI **0.10.0**, Node.js **24**, and persistent gateway **0.1.3**. The browser bridge has its [own installation guide](https://github.com/esmaesx/chrome-devtools-mcp-persistent-bridge). It is an optional companion package, separate from the extension repository.

## The normal interface

The extension has three mode tabs inside one dialog. The top tabs and middle file area remain in the same positions when you switch modes. The bottom status area reports progress, success, stops, or errors.

![Empty upload view](images/upload-empty.png)

- **Close** closes an idle dialog. Closing is disabled while a batch is active.
- **Choose files** opens the normal file picker.
- The large drop target accepts multiple loose files.
- **Select all**, **Select none**, and **Refresh list** help with download and delete selection.
- A stop button acts on the current batch; it does not undo completed work.

### Which upload method should I use?

| Method | How it works | When to use it |
| --- | --- | --- |
| Native page | Uses the page's existing file input and watches its completion | Default for the visible interface |
| Direct API | Uses the same browser login to prepare, upload, register, and verify the file | Preferred by the agent wrapper; useful when page controls change |

Both methods upload to the same task. Each successfully registered file can create one automatic Linear comment. Direct API does not mean anonymous access or a separate account.

## Upload files

### Select and review

1. Select **Upload loose files**.
2. Choose **Native page** or **Direct API** under **Upload method**.
3. Drag the required files into the drop target, or select **Choose files**.
4. Read the filenames and duplicate labels.
5. Select the acknowledgement about automatic Linear comments.
6. Select the upload button.
7. Check the exact names in the extension's confirmation and select **Confirm**. Select **Cancel** to leave the batch unstarted.

![Native upload selection with new files and a duplicate](images/upload-mode.png)

The extension accepts loose files, not folders. Selecting a ZIP uploads that ZIP as one file; it does not extract or upload its contents. Extract an archive first if the task needs its individual evidence files.

![Upload confirmation with the exact selected filenames](images/upload-confirmation.png)

### What happens to duplicates?

A selected filename that is already staged is skipped. A repeated filename within the new selection is also skipped after its first occurrence. Other new files continue.

This is filename-based handling. Selecting a changed file under an existing filename does not replace the existing file. To replace it, verify a local backup, delete the old staged entry deliberately, and then upload the replacement.

### Follow progress

Native mode watches the page's upload and finalization controls and waits for a stable new row before starting the next file. The status identifies the current file.

![Upload progress](images/upload-progress.png)

![Completed upload](images/upload-complete.png)

Direct API reports stages such as hashing, preparing, transferring, registering, and verifying. It compares the server's full SHA-256 and byte size with the file sent.

![Direct API selected as the upload method](images/upload-api-mode.png)

The API confirmation identifies the method as well as the exact file selection.

![Direct API upload confirmation](images/upload-api-confirmation.png)

![Direct API upload progress](images/upload-api-progress.png)

![Completed and verified API upload](images/upload-api-complete.png)

The native page table can remain stale after an API upload. Use the API result or API inventory to check completion. Refresh the page when convenient, after saving any question or table edits. The extension does not reload the page automatically.

### Stop an upload

Select **Stop after current file**. The active file is allowed to finish. No next file starts, and completed uploads remain staged.

![Upload stopped with files still remaining](images/upload-stopped.png)

In the human interface, unstarted files remain selected. Review the server inventory before starting a new batch. In the CLI, a stopped result lists the remaining filenames and releases the old selection; make a new plan for the files still needed.

### If an upload fails

The batch stops and reports the failed and remaining files. A failed response does not always mean that the server did nothing: registration can finish after the response is lost or delayed.

![Upload error and remaining selection](images/upload-error.png)

Read the current inventory and compare exact names and full hashes before making a new plan. Do not repeat an uncertain apply token. The extension performs read-only checks for late registration; it does not repeat registration automatically.

## Download files

1. Select **Download staged files**.
2. Select individual checkboxes or use **Select all**.
3. Select **Download selected files as ZIP**.
4. Wait while the extension reads and verifies the selected sources.
5. In the browser's **Save As** dialog, choose the ZIP filename and destination.

![Download selection](images/download-mode.png)

![ZIP preparation progress](images/download-progress.png)

One batch creates one ZIP and one Save As dialog. You can choose an existing directory or create a directory if your operating system's dialog supports it. The files are not saved through a separate dialog for each entry.

The native operating-system Save As dialog is not shown in this headless demonstration. Its appearance depends on Chrome or Edge and your operating system. The following screenshots show the extension's own result states.

![Completed ZIP download](images/download-complete.png)

![Cancelled download](images/download-cancelled.png)

**Stop after current file** stops ZIP preparation before the next source. No partial ZIP is offered by the extension. Cancelling Save As keeps the selection available. If saving has an uncertain outcome, check the browser's Downloads list before requesting another ZIP.

![ZIP preparation stopped before the next file](images/download-stopped.png)

The archive is uncompressed. Limits are 500 selected files, 256 MiB per source file, and 512 MiB of source data per archive. Ambiguous duplicate rows and changed hashes are rejected rather than guessed.

## Delete files

Deletion is permanent. Keep a verified local copy or download a backup first.

1. Select **Delete staged files**.
2. Select the exact entries to remove. Check filenames, sizes, and hash prefixes.
3. Select **Delete selected files**.
4. Review the extension's confirmation and select **Confirm**.
5. Use **Stop deletion** during the five-second window if you change your mind.

![Delete selection](images/delete-mode.png)

![Delete confirmation](images/delete-confirmation.png)

![Five-second deletion countdown](images/delete-countdown.png)

![Deletion in progress](images/delete-progress.png)

During the countdown, stop prevents the first deletion. After deletion starts, stop permits the current file to finish and prevents the next one. It cannot restore entries already removed.

![Deletion stopped](images/delete-stopped.png)

![Deletion completed](images/delete-complete.png)

The extension finds each next row again because the page changes after a deletion. It stops if the exact row cannot be proved. The CLI reports inventory before and after the operation. Do not infer success only from a checkbox disappearing.

Upload and delete confirmations are inside the extension. The managed native deletion path handles the page's expected confirmation. A direct click on the page's own remove button is a separate path and can still show a browser confirmation.

## Use the extension with an agent

### One package, two entry points

A person uses the visible dialog. An agent uses the companion CLI in the extension package. The CLI is a Node.js program that runs outside Chrome and communicates with the extension inside the selected browser.

**Agent → extension's CLI → extension in the browser → Tacit API**

The CLI validates local paths, creates a plan, sends verified file bytes, and returns structured results. The browser extension performs the API requests with the browser's existing login. The agent does not need to write its own upload requests or handle cookies and signed URLs.

### Setup and a useful request

Keep the task tab open in the intended browser/profile. Install Node 24 and the companion skill. For the recommended Windows Chrome route, install the persistent bridge and pass its proxy path to the wrapper. A browser debugging permission prompt can still require your approval; it is separate from permission to upload files.

For Codex, copy the contents of the repository's `skill` folder into `%USERPROFILE%\.codex\skills\teal-eval-bulk-cli`, including its `scripts` and `references` folders. The skill is available on a later turn. When the skill is outside the repository, pass `-ExtensionRoot` or set `TEAL_EVAL_BULK_EXTENSION_ROOT` to the unpacked extension folder. Other agents can read the bundled instructions and call the same CLI without a Codex skill installation.

Give the agent the task identifier, browser/profile, exact file paths, and requested action. For example:

> Use my open Chrome task DEMO-204. Upload the two files in C:\Packet listed below through the bulk-files CLI in API mode. Skip existing names and verify the final hashes. Do not change the question or grading tables.

The [installed skill source](../skill/SKILL.md) contains the operating workflow. The extension folder also includes [AGENTS.md](../extension/AGENTS.md), so an agent that discovers that folder can learn how to call its CLI.

### Plan, apply, verify

1. `status` checks whether the extension is available and busy.
2. `list` reads the inventory. The PowerShell wrapper defaults to API inventory.
3. `plan-upload` inspects all requested local files and returns actionable files, skips, and a one-use token. It does not upload anything.
4. `apply-upload` uses that token for the authorized batch.
5. `list` or `verify` checks the result. `verify` compares the complete intended local file set; use a list comparison for a partial batch.

![Illustrative CLI command and result layout with fictional values](images/cli-plan-example.png)

The plan normally expires after five minutes. It is bound to the issue, browser target, page state, inventory, filenames, file hashes, and upload method. A changed page or inventory can require a new plan. Apply inherits the saved upload method; it cannot silently switch methods.

The agent wrapper defaults to API for upload planning, list, and verify. Explicit `-UploadMode native` remains available. Download and deletion use their existing checked plan/apply paths; API upload mode does not change them.

### Approval and results

A matching authorized CLI plan does not open the extension's human Confirm button. The user request and one-use token control that path. CLI downloads still open one Save As dialog for the ZIP destination.

Every batch result must be read as a whole:

| Field | Meaning |
| --- | --- |
| `succeeded` | Files reported complete |
| `skipped` | Files excluded, with reasons such as an existing name |
| `failed` | Files with reported failures |
| `remaining` | Files that still need attention |
| `indeterminate` | The effect is uncertain; inspect inventory without replaying the action |
| `tokenConsumed` | The plan token has been spent, even if the operation did not fully succeed |

Agents can share the persistent bridge through bounded waiting and idle handoff. This does not guarantee strict queue order. An active operation can outlast the default 120-second wait. The wrapper accepts `-BridgeWaitSeconds` from 1 through 300. A wait failure is not permission to repeat a mutation whose completion is uncertain.

## Advanced: run the mjs CLI yourself

### Use the PowerShell wrapper

You can use the same interface as an agent. Set paths for your installation:

```powershell
$package = 'C:\Tools\teal-eval-bulk-files'
$cli = Join-Path $package 'skill\scripts\invoke-teal-cli.ps1'
$extension = Join-Path $package 'extension'
$bridge = 'C:\Tools\persistent-bridge\runtime\stdio-proxy.mjs'
$common = @{
  ExtensionRoot = $extension
  PersistentBridgePath = $bridge
  Issue = 'DEMO-204'
}

& $cli @common -Command status
& $cli @common -Command list
```

Replace the sample bridge path with the installed proxy path. Do not point it at the extension's `persistent-mcp-client.mjs`; that is an internal module.

With the bridge's normal Windows installation, you can set it as follows:

```powershell
$bridge = Join-Path $env:LOCALAPPDATA `
  'dev-newb\chrome-devtools-mcp-persistent-bridge\runtime\stdio-proxy.mjs'
$common.PersistentBridgePath = $bridge
```

Upload a batch:

```powershell
$files = @('C:\Packet\evidence.csv', 'C:\Packet\notes.txt')
$planText = & $cli @common -Command plan-upload -Files $files
if ($LASTEXITCODE -ne 0) { throw 'Planning failed. Read the CLI error.' }
$plan = $planText | ConvertFrom-Json
$plan.actionableFiles
$plan.skipped

# Run only after you have reviewed and authorized this exact batch.
$resultText = & $cli @common -Command apply-upload -PlanToken $plan.token
$applyExit = $LASTEXITCODE
$result = $resultText | ConvertFrom-Json
$result
"Apply exit code: $applyExit"

# A separate read confirms what is now staged.
& $cli @common -Command list
```

If those paths are the complete intended staged-file set:

```powershell
& $cli @common -Command verify -Files $files
```

For download, use `plan-download -Names ...` then `apply-download -PlanToken ...`. For deletion, first preserve a backup, then use `plan-delete -Names ...` and `apply-delete -PlanToken ...`. Use `-Command stop` to request a stop for an active batch. These are real actions on the named task; a plan alone does not perform them.

### Execute the JavaScript module directly

The `.mjs` suffix identifies a JavaScript module. Run it with Node, not by double-clicking it. PowerShell is a convenience wrapper; it is not required for the Node entry point.

```powershell
$mjs = Join-Path $extension 'teal-eval-bulk-cli.mjs'

node $mjs --persistent-bridge $bridge --issue DEMO-204 --upload-mode api list
```

The raw Node CLI retains native mode as its compatibility default. Include `--upload-mode api` for API planning, list, and verify. Apply inherits the mode from its token:

```powershell
$text = node $mjs --persistent-bridge $bridge --issue DEMO-204 `
  --upload-mode api plan-upload 'C:\Packet\evidence.csv' 'C:\Packet\notes.txt'
if ($LASTEXITCODE -ne 0) { throw 'Planning failed.' }
$plan = $text | ConvertFrom-Json

node $mjs --persistent-bridge $bridge --issue DEMO-204 apply-upload $plan.token
```

Commands are `status`, `list`, `plan-upload`, `apply-upload`, `plan-download`, `apply-download`, `plan-delete`, `apply-delete`, `verify`, and `stop`. Each command needs an issue and exactly one connection choice. The CLI does not provide a general-purpose API request or JavaScript execution command.

For an explicit direct connection, `--browser chrome`, `--browser edge`, or `--cdp http://127.0.0.1:<port>` is available. Choose the actual browser/session deliberately. A separate CDP connection can require another browser permission prompt. The shared persistent bridge is the preferred route for repeated Chrome agent work.

### Read or save JSON output

The CLI writes one JSON object to standard output. Diagnostics go to standard error. Capture the exit code immediately, before running another command:

```powershell
$json = node $mjs --persistent-bridge $bridge --issue DEMO-204 --upload-mode api list
$code = $LASTEXITCODE
$data = $json | ConvertFrom-Json
$data.inventory | Format-Table filename, sizeText, sha256
$json | Set-Content -Encoding utf8 '.\inventory.json'
"Exit code: $code"
```

Plan output contains a one-use token and can include local file paths. Keep saved plan files private. Ordinary inventory output does not expose browser login credentials.

| CLI exit code | Meaning | Next step |
| --- | --- | --- |
| 0 | Command completed without a reported failure | Inspect the result arrays and verify files |
| 2 | Invalid command or argument | Correct the command |
| 3 | Browser, bridge, or session connection failed | Check the selected session and read-only bridge status |
| 4 | Operation failed, stopped, mismatched, or is uncertain | Read the JSON; reconcile inventory before any new action |

PowerShell can reject a wrapper argument before Node starts. That produces a PowerShell error rather than the CLI's normal JSON object.

## Troubleshooting and limits

| Symptom | Check |
| --- | --- |
| No Bulk files button | Confirm that the extension is enabled, the URL is an allowed eval issue page, and the page was refreshed after installation |
| Version mismatch | Update the extension, CLI, and skill together; reload the extension and refresh the task |
| No matching tab | Open the named issue in the chosen browser/profile; the CLI does not open it for you |
| Several matching tabs | Select the intended target with `-TargetId` or `--target-id` from the listed safe choices |
| Bridge busy | Inspect the current owner and wait within the supported bound; do not kill processes by age or count |
| Upload appears missing after API success | Read API inventory; the native page table may need a safe refresh |
| Stale or expired token | Inspect current state and make a new plan; never reuse a consumed token |
| Slow preparation or registration | API POST steps can take up to ten minutes within the batch deadline; the server can be hashing or posting a comment |
| Uncertain save or registration | Check browser Downloads or server inventory; do not blindly repeat the action |

The upload batch has a two-hour deadline. API inventory reads have a 60-second limit. URL preparation and registration allow up to ten minutes each, bounded by the batch. Late-registration checks are read-only and bounded.

Chrome can resend a POST after a connection drops before response headers, even when the extension calls it once. The client detects duplicate rows and reports uncertainty. A guarantee of exactly one server registration would require server-side idempotency.

## What stays running

The CLI `.mjs` program normally starts for one command and exits when that command finishes. The extension's page code remains available while the eval tab is open. Its background worker wakes for browser events. The persistent bridge is a separate background service that allows commands to reuse the Chrome connection.

These parts being available does not mean files are uploading continuously. Uploads start only from the human confirmation path or an authorized CLI apply. If a transfer ends with an uncertain result, a separate bounded cleanup helper can retain the verified file snapshot until browser work can no longer need it.

For maintainers, see [screenshot reproduction](local-demo.md), [the CLI guide](cli-guide.md), and [the API upload guide](api-upload.md).
