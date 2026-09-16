# Reliability and recovery

Ainotation keeps browser feedback in IndexedDB and synchronized feedback in the
local MCP service. Losing one copy does not automatically delete the other.
The local-only SDK mode (`mcp: false`) never connects to service storage.

## Automatic recovery

The shared service holds an OS IPC listener in a private, user-scoped runtime
directory outside its data directory. Node integrations use this coordinator to
find the existing instance when `connection.json` or the entire data directory
disappears. The IPC response contains only a PID and instance ID. Its private
connection record is owner-only and is excluded from Vite's file serving, along
with the service data directory.

Every two seconds, the service checks its runtime metadata, project registry and
loaded feedback stores. Missing files are rebuilt from memory even when no new
annotation is created. Invalid JSON found in a loaded store is retained as a
`.corrupt-<UUID>` file before the in-memory snapshot is written back. A valid but
different on-disk snapshot is treated as a conflict, not silently overwritten.
On shutdown, an instance only removes metadata carrying its own instance ID.

Each feedback/registry write keeps one previous JSON snapshot in `.backup`.
Startup can recover a missing or invalid primary from a validated backup. A
feedback rollback changes its storage epoch so newer browsers can detect it.
Writes that fail are not acknowledged as successfully synchronized.

Image bytes remain separate PNG files. Missing images in active sessions notify
connected browsers, and sync responses identify which attachments need uploading
again, including ones the browser previously marked as uploaded. A browser that
does not hold the Blob cannot reconstruct it; it reports missing attachments
while keeping the feedback text usable.

## Browser recovery controls

Settings offers **Retry connection** after an error. **Restore project from
this browser** appears for connection errors, version conflicts, unresolved pages
or an ongoing recovery; it is hidden during normal operation. Project recovery checks each saved page
without navigation; pages with conflicts, unavailable origins or missing images
are listed for attention. The existing project/origin authorization boundaries
still apply. Feedback in another browser/profile is not accessible.

When a recovered server version differs from the browser version, automatic sync
pauses before replacing local data. Export a copy, then choose **Use browser
version** or **Use recovered server version** for that page. The choice is bound
to the server version that was reviewed; if it changes in the meantime, the SDK
asks for a new review. Matching snapshots without pending operations resume
automatically.

The service retains conflicting documents in `feedback.json.recovery/` (up to
100 distinct snapshots per project store), and retains image files removed by an
explicit recovery choice. The browser keeps its last three pre-recovery snapshots
with their image Blobs in IndexedDB. **Export previous local version** exports the
most recent one as JSON or an image ZIP. These recovery records are separate from
normal copied/exported feedback. Missing copies cannot be reconstructed, and lost
server deletion history cannot be inferred from an old browser snapshot.

## Diagnose and repair

Use the installed `ainotation-mcp` CLI, or its equivalent package runner. Commands
default to `~/.ainotation/service`; pass `--data-dir PATH` for a custom service.

```sh
ainotation-mcp doctor --json
ainotation-mcp repair --json
```

`doctor` is read-only. It reports process/metadata state, directory write access,
registry and feedback validation, and missing or invalid image files. Reports
contain paths and counts, not control tokens or feedback text.

`repair` contacts a verified live instance to republish missing state. With no
live service, it acquires the coordinator, quarantines stale metadata and attempts
validated backup recovery. It never signals a PID based only on a lock file.
Conflicting live owners and ambiguous locks require operator inspection.

If no valid JSON copy remains, explicitly opt into starting damaged stores empty:

```sh
ainotation-mcp service --stop
ainotation-mcp repair --reset-damaged
```

This preserves damaged files with unique suffixes; it does not reset valid stores
or treat permission/disk failures as corrupt data. Restart the Vite applications
to register projects, reconnect the MCP client, then use browser recovery. Do not
clear browser storage while it is the remaining copy.

An interrupted repair/backup process can leave a coordinator `.repair` lock. The
diagnostic report gives its location. Check the recorded PID and remove that lock
only after confirming the operation has stopped.

## External backups

The adjacent `.backup` files cannot survive deletion of the entire data directory.
For that case, create a separate backup while the shared service is stopped:

```sh
ainotation-mcp service --stop
ainotation-mcp backup --to /path/to/ainotation-backups --keep 3
```

Backups contain registry, feedback, recovery snapshots and image files. They omit
live credentials and locks. Retention only removes recognized completed snapshots
for the same source directory; the supported retention range is 1–20 snapshots.
No periodic external backup is enabled automatically. A system scheduler may run
the command during a maintenance window.

Restore a completed snapshot with:

```sh
ainotation-mcp repair --restore-from /path/to/ainotation-backups/<snapshot>
```

Restore requires a stopped service, validates feedback before installation, and
preserves existing data under `before-restore-<UUID>`. Restored feedback receives
new epochs. If installation is interrupted, a pending marker blocks normal
service startup; repeat the restore with the original snapshot. Symlink entries
are refused and backup/restore source and destination must be separate.

## Upgrade and limits

Stop an older shared service before upgrading, then restart the Vite apps and MCP
client. The new coordinator cannot retroactively protect an already-running old
binary. Recovery protocol fields are additive; conflict detection and automatic
missing-image repair require the upgraded SDK and MCP service together.

This is local recovery, not a cloud backup service. It cannot recover data absent
from the service, browser, retained snapshots and external backups. A disk or
permission failure must be corrected before durable synchronization can resume.
