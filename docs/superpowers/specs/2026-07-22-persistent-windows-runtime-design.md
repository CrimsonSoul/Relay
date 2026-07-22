# Persistent Windows Runtime Bootstrap Design

**Date:** 2026-07-22
**Status:** Draft — approach approved

## Summary

Relay will continue to ship as one downloadable `Relay.exe`, but that executable will become a per-user bootstrapper instead of electron-builder's stock portable wrapper. The bootstrapper will extract each Relay build once into a persistent, versioned runtime under `%LOCALAPPDATA%`, install a small stable launcher, create or refresh the user's Desktop and Start Menu shortcuts, activate the new runtime atomically, and launch Relay.

Normal launches will use the stable launcher at `%LOCALAPPDATA%\Relay\Relay.exe`. The launcher will start the already-extracted Electron executable directly, so it will not unpack the application on every launch. A new downloaded `Relay.exe` only needs to be run once to stage and activate that build; the shortcuts do not change location between upgrades.

Relay's data remains under `%APPDATA%\Relay\data`. This design does not add an administrator requirement, registry installation, Windows service, background updater, or uninstaller. The Windows executables remain unsigned unless signing is introduced separately.

## Verified Problem

The current Windows target is electron-builder's `portable` target. Its stock NSIS script creates a temporary runtime directory, removes any prior contents, extracts the complete application, starts the inner Electron executable, waits for it to exit, and removes the runtime. The current Windows branch artifact is approximately 530 MB and is an unsigned NSIS self-extracting executable.

This wrapper work happens before Relay's main-process entry and is therefore absent from the existing startup benchmark. The application-level startup optimizations already on `test` reduce work after Electron starts, but they cannot reduce portable extraction or antivirus scanning that occurs before Electron starts. A drop-in upgrade is especially exposed to cold filesystem and security-scanner caches.

Persistent extraction eliminates that wrapper cost from every launch after a build has been prepared. It does not eliminate the first extraction of a genuinely new build. The new bootstrap must therefore provide immediate visible progress and use a Windows-benchmarked compression mode for the one required extraction.

## Goals

- Preserve a single downloadable Windows artifact named `Relay.exe`.
- Extract a given Relay build at most once during normal use.
- Make Desktop and Start Menu shortcuts stable across upgrades.
- Allow a new build to be prepared while the previous runtime is still running.
- Keep the previous complete runtime available when extraction or activation fails.
- Preserve `%APPDATA%\Relay\data` and all existing application configuration.
- Require no elevation and create no machine-wide state.
- Show `Preparing Relay...` promptly while a new runtime is being extracted.
- Measure the complete packaged startup path, including bootstrap and extraction time.

## Non-goals

- A traditional Windows installation or Add/Remove Programs entry.
- An uninstaller, Windows service, scheduled task, or always-running updater.
- Machine-wide shortcuts or files under `Program Files`.
- Code signing, SmartScreen reputation, or bypassing antivirus inspection.
- Differential binary updates or downloading payloads from inside the bootstrapper.
- Preserving arbitrary user-created shortcuts that point directly to an old downloaded portable executable.
- Claiming that the first launch of a new build can avoid extracting that build.

## Filesystem Contract

The runtime and application data remain deliberately separate:

```text
%LOCALAPPDATA%\Relay\
├── Relay.exe                     stable, small launcher
├── state.ini                     active and fallback build identifiers
└── Runtime\
    ├── <build-id>\
    │   ├── Relay.exe             packaged Electron executable
    │   ├── resources\...
    │   └── .relay-runtime-ready  completion marker
    ├── <previous-build-id>\...
    └── .staging-<build-id>-<id>\...

%APPDATA%\Relay\
└── data\...                      existing Relay configuration and PocketBase data
```

No credential, server secret, user record, or application data is stored in the bootstrap state. Removing `%LOCALAPPDATA%\Relay` removes only launch/runtime files; it does not remove Relay data.

`state.ini` uses a versioned protocol and contains only validated build identifiers:

```ini
[Relay]
protocol=1
current=<build-id>
previous=<build-id>
```

The launcher never accepts an arbitrary executable path from the state file. It accepts only a bounded build identifier containing ASCII letters, digits, `.`, `_`, and `-`, then constructs the executable path beneath the fixed runtime root. This prevents a malformed state file from turning the launcher into a general process launcher.

## Build Identity and Packaging

The package version is currently `1.0.0` across branch builds, so it cannot identify runtime contents. Each Windows artifact will receive a bounded build ID containing:

- a bootstrap format revision; and
- the source commit identifier supplied by CI.

CI builds use the full checked-out commit as their source of identity and inject a shortened, validated representation into the package. A dirty local packaging run adds a unique dirty suffix so it cannot reuse a runtime produced from different contents under the same commit. Packaging fails if the build ID is missing, invalid, or too long.

The Windows build will replace the stock `portable` target with a custom NSIS bootstrap target. electron-builder will still produce the unpacked Electron application and payload archive. The same pinned NSIS toolchain will also compile the small stable launcher from checked-in source before the outer bootstrap is compiled. The final published artifact remains `release/Relay.exe`.

The payload contains a small manifest with at least the build ID, bootstrap protocol version, application executable name, and payload digest. NSIS extraction validation plus the completion marker distinguish a complete runtime from an interrupted staging directory. A runtime is never considered reusable merely because its directory exists.

The Windows branch and release workflows will pass an explicit build ID. The release workflow will no longer assume `maximum` compression is best for startup. `store`, fast/normal compression, and the current release compression will be compared on the same Windows host; the fastest repeatable first-update result that keeps distribution size operationally acceptable will be selected and documented.

## Bootstrap Flow

The downloaded bootstrapper runs as the current user and requests `asInvoker` execution. Its flow is:

1. Acquire a per-user bootstrap mutex so two downloaded copies cannot mutate runtime state concurrently.
2. Resolve the fixed `%LOCALAPPDATA%\Relay` root and read the current state if it is valid.
3. Check for a complete runtime matching the embedded build ID.
4. If the runtime is missing or incomplete, immediately show a small native `Preparing Relay...` progress surface.
5. Extract the embedded application into a unique staging directory under `Runtime`.
6. Validate the extracted executable and manifest, then write the completion marker last.
7. Rename the staging directory to the final versioned directory on the same volume.
8. Install or verify a launcher compatible with state protocol 1.
9. Write the new state to a sibling temporary file and atomically replace `state.ini`, moving the former current ID to `previous`.
10. Create or refresh the per-user Desktop and Start Menu shortcuts so both target the stable launcher.
11. Close the preparation UI and invoke the stable launcher with the original user arguments.

When the embedded build is already complete and active, the bootstrapper skips extraction, refreshes the launcher and official shortcuts if needed, and launches Relay.

The bootstrapper will not wait for the Electron process to exit and will not delete the active runtime. This differs from the current portable wrapper, which remains alive and deletes its temporary runtime after Relay exits.

## Stable Launcher Contract

`%LOCALAPPDATA%\Relay\Relay.exe` is a small native launcher with the Relay icon. It performs no extraction and no network access. It:

1. reads and validates protocol 1 state;
2. resolves the `current` runtime beneath the fixed root;
3. requires the completion marker and inner `Relay.exe` to exist;
4. starts the inner executable with the original command-line arguments and its runtime directory as the working directory; and
5. exits after process creation succeeds.

If the current runtime is missing or cannot be started, the launcher attempts the validated `previous` runtime. If neither is usable, it shows bounded guidance to run the downloaded `Relay.exe` again. The launcher does not silently search arbitrary directories.

A reserved probe argument lets the bootstrapper and Windows tests verify the launcher's protocol without launching Electron. Bootstrap activation occurs only after a compatible launcher is present. Launcher replacement uses a sibling temporary file and an atomic replace; an existing compatible launcher may be retained if Windows temporarily has it open.

Relay's existing Electron single-instance lock remains authoritative. Two shortcut launches can both reach the inner executable, but the second Electron instance will focus the first window and exit through the existing path. The crash watchdog and Electron relaunches continue to use the active inner executable, which remains available as `current` or `previous` while it is running.

## Shortcut and Upgrade Behavior

Every successful bootstrap run creates or updates:

- `%USERPROFILE%\Desktop\Relay.lnk`; and
- `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Relay\Relay.lnk`.

Both shortcuts target `%LOCALAPPDATA%\Relay\Relay.exe`, use its embedded Relay icon, and retain the same target across all future upgrades. Running a new downloaded `Relay.exe` once is sufficient to prepare the new runtime and refresh both official shortcuts. Users then continue launching Relay from the same shortcuts.

The first adoption of this format does not remove the downloaded executable or any older portable file; those files remain under user control. An existing official shortcut named `Relay` is replaced. Arbitrary custom shortcuts and taskbar pins that directly reference an old portable file cannot be updated safely; those users need a one-time re-pin from the refreshed Start Menu shortcut. Future pins based on the stable launcher remain valid.

## Atomicity, Concurrency, and Recovery

- Extraction always targets a unique staging directory. The active state never points to staging.
- The completion marker is written only after the payload and manifest validate.
- Staging-to-final rename occurs on the same volume. A failed rename leaves the prior state untouched.
- State activation is an atomic file replacement. A crash before replacement leaves the previous state authoritative; a crash after replacement leaves a complete new runtime authoritative.
- Preparing build B does not modify build A, so build A may remain running throughout the update.
- If build B extraction or activation fails, the bootstrapper removes its incomplete staging directory when possible, preserves build A as current, reports the failure, and starts the still-valid build A after the user dismisses the error.
- If no prior runtime exists, failure produces a clear error and a nonzero exit code.
- A second bootstrap process never attempts a competing extraction. It either launches the existing active runtime or reports that Relay is already being prepared when no active runtime exists yet.
- Launcher and bootstrap error copy contains no local paths, secrets, payload hashes, or implementation details.

## Runtime Retention and Cleanup

The active and previous complete runtimes are retained for fallback. Incomplete staging directories and runtimes older than the fallback are cleanup candidates.

Cleanup is not part of the launch-critical path. After Relay reaches workspace readiness, a bounded deferred maintenance task may remove unreferenced runtime directories. Locked directories are skipped without error and retried during a later maintenance opportunity. Cleanup never follows paths outside the fixed runtime root and never touches `%APPDATA%\Relay`.

This policy avoids delaying startup with deletion of hundreds of megabytes and permits an old runtime to finish running during an upgrade. Temporary accumulation after interrupted or in-use upgrades is acceptable; unbounded silent accumulation is not.

## Performance and Instrumentation

Packaged Windows performance will be measured as two separate scenarios:

- **prepare-and-launch:** start the downloaded bootstrap for a build not present in the runtime cache and measure until Relay's existing renderer/workspace milestones; and
- **stable launch:** start the installed shortcut/launcher for an already prepared build and measure the same milestones.

The benchmark must start before the outer process is created. It must not label a second launch of the same unpackaged Electron build as a post-update result. Results record bootstrap preparation time, process handoff time, Electron startup milestones, artifact size, compression mode, and whether the runtime was reused. Logs remain bounded and contain no user data.

The initial preparation UI must appear before payload extraction begins. Stable launches must not touch runtime file modification times, create a staging directory, start the downloaded SFX, or perform payload decompression.

Compression is selected from repeated Windows measurements, not package-build duration or a single run. A candidate must improve the same-machine median prepare-and-launch time over the current production portable artifact without regressing stable-launch correctness. Antivirus variance is recorded rather than bypassed.

## Testing Strategy

Implementation follows red-green TDD in coherent behavior slices.

### Build and state contract

- Reject missing, unsafe, or oversized build IDs.
- Distinguish clean CI builds from dirty local packages.
- Validate protocol 1 state and reject traversal or absolute-path values.
- Prove activation preserves the former current build as previous.
- Prove a partial runtime is never reusable without its completion marker.

### Launcher

- Resolve only complete current or previous runtimes under the fixed root.
- Prefer current, fall back to previous, and fail clearly when neither is usable.
- Forward quoted arguments without reinterpretation.
- Keep probe mode side-effect free.
- Preserve the existing Electron single-instance and crash-watchdog behavior when started through the launcher.

### Bootstrap state machine

- Fresh preparation stages, validates, activates, creates both shortcuts, and launches.
- Re-running the same build reuses the runtime without extraction.
- Updating A to B leaves A untouched until B is complete and atomically makes B current/A previous.
- A forced failure at each staging and activation boundary leaves A launchable.
- Concurrent bootstrap attempts cannot race state or extraction.
- Updating while A is running makes B the target of the next stable launch.

### Packaged Windows verification

- Compile the production bootstrap and launcher on `windows-latest` using the pinned NSIS toolchain.
- Run a small Windows bootstrap harness built from the same NSIS macros against isolated fixture roots to exercise A-to-B updates and injected failures.
- Run the real artifact in bootstrap-only smoke mode on the disposable CI user profile, verify the runtime marker and official shortcut targets, rerun it, and prove the runtime was reused.
- Verify the final PE files request no elevation and the workflow publishes only the expected `Relay.exe` artifact.
- Confirm `%APPDATA%\Relay\data` is unchanged across preparation, activation, fallback, and cleanup tests.
- Run the existing unit, renderer, typecheck, lint, format, and production-build checks.
- Perform final prepare-and-launch and stable-launch timing on real Windows hardware because macOS cannot validate Defender, NTFS, shortcut, process-locking, or GPU behavior.

Test-only failure injection and alternate roots are compiled only into the isolated harness. The production bootstrap does not accept a command-line path that can redirect extraction outside `%LOCALAPPDATA%\Relay`.

## Rollout

The first custom-bootstrap artifact is a one-time format migration:

1. The user downloads and runs the new `Relay.exe`.
2. Relay prepares the persistent runtime and creates both official shortcuts.
3. Existing `%APPDATA%\Relay\data` is reused unchanged.
4. The user launches subsequent sessions from the Desktop or Start Menu shortcut.
5. For later upgrades, the user runs the newly downloaded `Relay.exe` once; the same shortcuts then start the new runtime.

Rollback is operationally simple: running an older custom-bootstrap artifact stages that build and makes it current while retaining the newer build as previous. Schema/data compatibility remains Relay's existing responsibility; this bootstrap does not roll application data backward.

## Known Limitations

- The first run of each new build still writes the complete runtime once. Persistent extraction makes later starts fast and makes the wait visible; it cannot make new bytes exist without extraction.
- Unsigned bootstrap, launcher, and runtime executables retain the current SmartScreen and antivirus-reputation limitations.
- A large uncompressed or lightly compressed artifact may download more slowly even when it prepares faster. The Windows benchmark decides the production tradeoff.
- Existing custom shortcuts or pins aimed at an old portable executable need a one-time replacement.
- Removing the downloaded `Relay.exe` does not uninstall Relay; runtime files remain until `%LOCALAPPDATA%\Relay` is removed manually.

## Acceptance Criteria

- The published Windows deliverable remains one `Relay.exe` and runs without elevation.
- A fresh run creates a complete versioned runtime, stable launcher, Desktop shortcut, and Start Menu shortcut.
- Both official shortcuts always target `%LOCALAPPDATA%\Relay\Relay.exe`.
- Repeated normal launches perform no extraction or runtime deletion.
- A successful A-to-B upgrade is atomic, preserves A as fallback, and uses B on the next shortcut launch even when A was running during preparation.
- An interrupted or failed upgrade never makes a partial runtime current and leaves the prior build launchable.
- Relay data remains at `%APPDATA%\Relay\data` and is byte-for-byte untouched by bootstrap operations.
- The complete packaged benchmark demonstrates a repeatable improvement over the current portable wrapper for stable launches and selects the best measured release compression for first-update preparation.
- The launcher, bootstrap harness, Windows artifact smoke tests, and existing Relay verification suite pass before the change is pushed to `test`.
