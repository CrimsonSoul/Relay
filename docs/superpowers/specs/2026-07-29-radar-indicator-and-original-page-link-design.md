# Radar Indicator and Original Page Link Design

## Goal

Make Radar's sidebar health indicator easier to see and add a direct path from
Relay's reconstructed Radar view to the original CW Dispatcher Radar webpage.

This is a focused visual and navigation change. It does not change Radar
polling, authentication, parsing, snapshots, notifications, or toast priority.

## Sidebar Indicator

Increase the Radar status dot from 6px to 10px. Keep it vertically centered at
the right edge of the standard sidebar button:

- expanded sidebar: 120px by 56px button, 10px right inset;
- collapsed sidebar: 56px by 48px button, 5px right inset.

The status dot continues to use the existing semantic Radar colors and remains
decorative because the button's accessible name and tooltip contain the
human-readable state.

The Radar tab must retain the same footprint, icon position, label position,
and active accent rail as every other primary navigation tab. The larger dot
must remain fully contained without overlapping the icon in collapsed mode.

## Original Radar Page Button

Add a secondary **OPEN ORIGINAL** button to the Radar header immediately before
the existing **REFRESH** button. Its accessible label and title are
**Open original Dispatcher Radar page**.

Clicking the button opens:

`https://cw-intra-web/CWDashboard/Home/Radar`

The action uses Relay's existing `openExternal` bridge:

- Electron asks the operating system to open the URL in the default browser.
- Relay Web opens the URL in a new browser tab with opener isolation.

The regular browser owns its own SSO state, so the original page may ask the
user to sign in. Opening it does not create a Relay window or another Radar
poller.

## Canonical URL

Move `RADAR_URL` from the main-only Radar session module into a shared Radar
module. Both the main-process fetch/sign-in path and the renderer button import
that one constant. The URL must not be duplicated in the renderer.

No new IPC channel or bridge method is needed.

## Responsive Behavior

The Radar header actions may wrap when horizontal space is constrained. The
status chip, **OPEN ORIGINAL**, and **REFRESH** remain individually usable and
inside the Radar header at supported widths.

## Verification

Focused tests will prove:

- the sidebar dot is exactly 10px in both dimensions;
- expanded and collapsed Radar buttons retain the standard navigation
  footprint and geometry;
- the larger dot stays vertically centered, inside the button, and clear of
  the icon in collapsed mode;
- clicking **OPEN ORIGINAL** calls `openExternal` with the canonical shared
  Radar URL;
- the button retains its accessible label and secondary styling;
- existing Radar refresh and snapshot behavior remains unchanged;
- no new polling or standalone-window path is introduced.

The complete Relay source gates, build, audit, and Electron suite will run
before completion.
