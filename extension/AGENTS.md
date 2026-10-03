# Agent file operations

These instructions apply when an agent uses this extension to manage staged files. They do not authorize changes to any task by themselves.

Use the CLI to give the extension local file paths. The extension owns the API prepare, byte transfer, registration, and verification steps in the selected signed-in browser. Do not copy browser cookies or signed upload URLs into another client.

## Preferred interface

Use the companion skill's `scripts/invoke-teal-cli.ps1` with `-PersistentBridgePath` and the user's exact issue. The wrapper selects API mode by default for `plan-upload`, `list`, and `verify`. `apply-upload` inherits the saved token's mode. Use `-UploadMode native` only for a deliberate native fallback.

If only this extension directory is available, the Node CLI is `teal-eval-bulk-cli.mjs`. Pass the mode explicitly:

```text
node <extension-root>/teal-eval-bulk-cli.mjs --persistent-bridge <absolute-stdio-proxy-path> --issue DEMO-204 --upload-mode api list
node <extension-root>/teal-eval-bulk-cli.mjs --persistent-bridge <absolute-stdio-proxy-path> --issue DEMO-204 --upload-mode api plan-upload <absolute-file-1> <absolute-file-2>
node <extension-root>/teal-eval-bulk-cli.mjs --persistent-bridge <absolute-stdio-proxy-path> --issue DEMO-204 apply-upload <returned-token>
```

Node 24, extension 0.10.1, and persistent gateway 0.1.3 are required. The raw Node CLI keeps its native default for compatibility; the explicit flag above selects API mode. Use the existing chosen browser session. Do not launch a separate Chrome client.

## Result checks

- A plan is read-only. Apply only a user-authorized batch with its one-use token.
- Keep the plan's full filename and SHA-256 manifest.
- Each registered file can create one automatic Linear comment.
- After upload, use API `list`; the native table can remain stale. Require one row per filename and a complete matching SHA-256. Use `verify` with the complete intended file set only.
- Read succeeded, skipped, failed, remaining, exitCode, and indeterminate. Do not repeat an uncertain apply or registration. Read inventory to reconcile it.
- Use `stop` to stop after the current file. It does not need a new upload plan.
- API mode currently covers uploads and inventory reads. Download and deletion use their existing plan/apply commands. Do not pass the upload-mode option to those commands.
- Preserve unsaved question, rubric, and answer-table fields. Do not reload a page to update the native file table without checking for unsaved edits.

The companion skill and API guide contain full examples. No direct API scripting by the agent is needed for ordinary file work.
