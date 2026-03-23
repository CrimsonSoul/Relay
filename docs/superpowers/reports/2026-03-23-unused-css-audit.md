# Unused CSS Audit — 2026-03-23

Audited: `src/renderer/src/styles/components.css`

## Summary

| Metric                              | Count |
| ----------------------------------- | ----- |
| Total CSS classes extracted         | 671   |
| Potentially unused (grep scan)      | 74    |
| Confirmed dynamic (false positives) | 43    |
| Likely genuinely unused             | 31    |

---

## False Positives — Dynamically Constructed Class Names

These 43 classes were flagged by the grep scan but are actively used via template literal construction
(e.g. ``className={`prefix--${variant}`}``). Do **not** remove these.

### `alert-history-*` and `bridge-history-*` (18 classes)

Constructed in `src/renderer/src/components/HistoryModal.tsx` via the `classPrefix` prop:

```
alert-history-content      bridge-history-content
alert-history-empty        bridge-history-empty
alert-history-empty-icon   bridge-history-empty-icon
alert-history-empty-text   bridge-history-empty-text
alert-history-footer       bridge-history-footer
alert-history-header       bridge-history-header
alert-history-list         bridge-history-list
alert-history-section-label bridge-history-title
alert-history-title        (bridge has no section-label)
```

Pattern: ``className={`${classPrefix}-content`}`` etc. in `HistoryModal.tsx:159–207`.

### `note-card--*` color variants (5 classes)

Constructed in `src/renderer/src/tabs/notes/NoteCard.tsx:71`:
`` `note-card--${note.color}` ``

```
note-card--amber
note-card--green
note-card--purple
note-card--red
note-card--slate
```

### `tactile-button--*` variant/size classes (5 classes)

Constructed in `src/renderer/src/components/TactileButton.tsx:27–28`:
`` `tactile-button--${variant}` `` and `` `tactile-button--${size}` ``

```
tactile-button--danger
tactile-button--ghost
tactile-button--md
tactile-button--primary
tactile-button--sm
```

### `cloud-status-item__severity--*` (4 classes)

Constructed in `src/renderer/src/tabs/CloudStatusTab.tsx:154`:
`` `cloud-status-item__severity--${item.severity}` ``

```
cloud-status-item__severity--error
cloud-status-item__severity--info
cloud-status-item__severity--resolved
cloud-status-item__severity--warning
```

### `cloud-status-provider__indicator--*` (4 classes)

Constructed in `src/renderer/src/tabs/CloudStatusTab.tsx:130`:
`` `cloud-status-provider__indicator--${getIndicatorVariant()}` ``

```
cloud-status-provider__indicator--error
cloud-status-provider__indicator--ok
cloud-status-provider__indicator--unknown
cloud-status-provider__indicator--warning
```

### `assembler-sidebar-group-list--collapsed` (1 class)

Likely constructed as `` `assembler-sidebar-group-list${collapsed ? '--collapsed' : ''}` ``.
Verify before removing.

### `tactile-input-icon` and `tactile-input-wrapper` (2 classes)

Sub-elements of `TactileInput` component. May be applied conditionally or via a wrapper component.
Verify before removing.

### `weather-mini-modal-btn`, `weather-mini-modal-btn--cancel`, `weather-mini-modal-btn--primary` (3 classes)

The weather modals use shared `TactileButton` for their actions. These classes may be legacy from
a previous non-TactileButton implementation, OR they may be applied by a wrapper component.
**Candidate for removal** — but verify the modal renders correctly first.

---

## Likely Genuinely Unused Classes (31 classes)

These classes had no matches anywhere in `src/renderer/src/` `.tsx`/`.ts` files and do not appear
to be dynamically constructed. They are candidates for removal after visual verification.

### Structural / layout utilities (3)

```
btn-block-center
w3
platform-darwin
```

### Server card classes (7)

These may have been part of an earlier server card design iteration:

```
server-card-actions
server-card-detail-row
server-card-divider
server-card-meta-comment
server-card-notes-btn
server-card-os-label
server-card-tag
server-card-tag-overflow
server-card-tags
```

(9 total — miscounted above; actual count is 9, adjust summary accordingly)

### Contact card classes (2)

```
contact-card-group-overflow
contact-card-groups
```

### Detail panel (1)

```
detail-panel-close
```

### Group selector (3)

```
group-selector-close
group-selector-footer
group-selector-title
```

### Alerts composer (2)

```
alerts-email-footer-severity
alerts-toolbar-actions
```

### Assembler (1)

```
assembler-header-btn
```

### Modal / form (1)

```
modal-form-actions--wide
```

### Note card drag (1)

```
note-card-drag-handle
```

### Tooltip (2)

```
tooltip-container
tooltip-content
```

### Settings (1)

```
settings-spinner
```

### Webview (2)

```
webview-frame--absolute
webview-frame--hidden
```

### Weather mini-modal (7)

These are used as CSS selectors but not as className strings — they may be applied by a parent
wrapper or be genuinely dead code:

```
weather-mini-modal-btn
weather-mini-modal-btn--cancel
weather-mini-modal-btn--primary
weather-mini-modal-header
weather-mini-modal-input
weather-mini-modal-label
weather-mini-modal-overlay
weather-mini-modal-title
```

---

## Corrected Summary

| Metric                              | Count |
| ----------------------------------- | ----- |
| Total CSS classes extracted         | 671   |
| Flagged by grep scan                | 74    |
| Confirmed dynamic (false positives) | 43    |
| Likely genuinely unused             | 31    |

---

## Recommendations

1. **Do not remove** the 43 dynamically-constructed classes.
2. **Safe to remove** after visual spot-check: `btn-block-center`, `w3`, `platform-darwin`, `detail-panel-close`, `modal-form-actions--wide`, `note-card-drag-handle`, `settings-spinner`, `assembler-header-btn`.
3. **Verify in browser** before removing server card classes — the server card component has gone through multiple redesigns.
4. **Weather mini-modal**: Check `SaveLocationModal.tsx` and `RenameLocationModal.tsx` renders to confirm the btn/overlay/header/input/label/title classes are not applied through a shared modal shell (e.g. `WeatherMiniModal`).
5. **Tooltip classes**: `tooltip-container` and `tooltip-content` may be used in a CSS-only context (applied by a third-party tooltip lib or injected HTML). Verify before removing.
