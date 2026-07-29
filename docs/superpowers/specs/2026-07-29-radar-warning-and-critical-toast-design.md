# Radar Warning and Critical Toast Design

## Goal

Extend Relay's existing desktop Radar queue notifications so the same three
operational targets alert when their dashboard status escalates to yellow or
red:

- Prod01 (including the existing Prod1 alias)
- Prod02 (including the existing Prod2 alias)
- Transactional Emails Queue Depth

This is a focused behavior change. It does not change Radar parsing, polling,
sidebar status, toast priority, sound behavior, or Relay Web.

## Transition Rules

Relay compares each target's latest explicit usable tone with its previous
explicit usable tone. It notifies only when severity increases into an
actionable tone:

| Previous tone | New tone | Notify |
| ------------- | -------- | ------ |
| green         | yellow   | Warning |
| green         | red      | Critical |
| yellow        | red      | Critical |
| yellow        | green    | No |
| red           | yellow   | No |
| red           | green    | No |
| unchanged     | unchanged | No |

The first usable snapshot remains a silent baseline, even if a target is
already yellow or red. A missing target does not change its remembered tone.
Uninitialized, stale, errored, or sign-in-required snapshots do not notify and
do not change transition state.

## Toast Presentation

A yellow-only transition uses a warning toast and identifies the affected
queue or queues as yellow. A red-only transition retains the existing critical
toast treatment. If different targets escalate to yellow and red in the same
snapshot, Relay emits one combined critical toast that names each target and
its new status.

All Radar operational toasts:

- use the existing `radar-critical` delivery class so their priority remains
  below Dynatrace Problems and above cloud notifications;
- remain visible for eight seconds;
- include an **Open Radar** action;
- do not play a sound.

## Components

`RadarQueueNotificationManager` continues to own target matching, snapshot
eligibility, transition detection, batching, and toast content. No new global
state or IPC is needed.

The operational toast queue and `App` mounting remain unchanged because they
already provide the approved delivery priority and desktop-only boundary.

## Verification

Focused renderer tests will prove:

- each of the three targets alerts on green-to-yellow;
- yellow-to-red produces a second critical toast;
- red-to-yellow recovery remains silent;
- simultaneous yellow and red escalations produce one combined toast;
- startup, repeat, missing-target, and unusable-snapshot behavior remains
  silent;
- the action, priority class, duration, and no-sound behavior remain intact.

The complete Relay verification gates and Electron suite will run before the
change is considered complete.
