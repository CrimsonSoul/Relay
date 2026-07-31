# Retire macOS Releases

## Goal

Make Relay a Windows-only distributed product while preserving macOS as a supported development
host. Relay must no longer build, publish, advertise, or retain macOS release artifacts.

## Scope

- Remove the macOS packaging job from the normal GitHub Actions build workflow.
- Remove the `build:mac` package script and the macOS target from `electron-builder.yml`.
- Remove macOS release claims from public documentation and clarify that macOS remains supported
  for local development only.
- Update packaging contract tests so they describe and enforce Windows-only distribution.
- Delete the existing `relay-mac-arm64` artifacts from GitHub Actions.

## Preserved Development Behavior

- `npm run dev`, local Electron testing, and the normal validation suite must continue to run on
  macOS.
- Darwin PocketBase download and startup support must remain because local development uses the
  native PocketBase binary.
- Runtime code that handles macOS development behavior must remain unless it exists solely for
  building a distributable package.
- Windows packaging, Windows startup benchmarks, security gates, and release automation must not
  change behavior.

## Configuration Changes

The `package-mac` job and its caches, PocketBase package downloads, DMG build, and artifact upload
will be removed from `.github/workflows/build.yml`. The Windows and quality jobs will remain
unchanged.

The `build:mac` script will be removed from `package.json`. The `mac` block and the macOS-only
ad-hoc signing fuse setting will be removed from `electron-builder.yml`; Windows packaging settings
will remain intact.

The README platform badge will identify Windows as the distributed platform. Development guidance
will explicitly distinguish the Windows release target from macOS local-development support.

## Tests and Verification

- Update the existing packaging contract tests to reject Mac release jobs, scripts, builder
  targets, and uploaded Mac artifacts while preserving Darwin development support.
- Run the focused packaging and workflow contract tests first.
- Run typechecking, linting, formatting checks, the full test suite, the production build, the
  production dependency audit, and `git diff --check` before publication.
- Confirm the workflow contains no macOS runner or Mac artifact upload and that Windows packaging
  remains configured.
- Confirm GitHub has no remaining `relay-mac-*` artifacts after deleting the two current artifacts.

## Non-Goals

- Do not block Relay from running on macOS during development.
- Do not remove Darwin PocketBase support or generic cross-platform runtime code.
- Do not add a replacement manual or on-demand Mac release workflow.
- Do not modify Windows packaging, Relay Web, application features, or data behavior.

## Completion Criteria

Relay produces and advertises only Windows release artifacts, local development continues to work
on macOS, all required verification gates pass, and GitHub Actions retains no Mac release artifact.
