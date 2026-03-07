# Alert Style Carousel Design

## Problem

The alerts tab has a single card layout. Users want multiple visual styles to choose from for company-wide alerts pasted into Outlook.

## Solution

Add a horizontal carousel to the preview panel that lets users flip through 8 named card styles. All styles are light-themed, html2canvas-safe, and use the same data props.

## UI

- Thin nav bar at the top of the preview panel: `< Classic >` with left/right arrow buttons
- One card visible at a time, full-size
- Arrows wrap around (last to first)
- Style selection is session-only, resets to "Classic" on restart

## Styles

1. **Classic** — current design. Colored header with stacked ALERT/severity label, centered icon circle, subject, meta bar with FROM/TO/date, body, colored footer strip.
2. **Minimal** — no colored header. Thin colored top bar (4-6px), severity shown as a colored pill badge, clean white layout, lightweight feel.
3. **Compact** — single-row header with severity + subject inline, denser layout for shorter alerts. Less vertical space.
4. **Banner** — full-width colored banner takes up more vertical space, icon + subject overlaid on the banner, bold/impactful for critical alerts.
5. **Sidebar** — colored severity bar on the left edge instead of top, horizontal layout shift. Subject and body flow to the right of the bar.
6. **Corporate** — logo prominent top-center, severity as a subtle colored tag beneath it, very clean and buttoned-up.
7. **Bordered** — white background, no filled header, thick colored left border + colored severity text, lightweight and modern.
8. **Split** — left colored panel with severity/icon, right white panel with subject/body, two-column layout.

## Architecture

### Props

All styles receive the same `AlertCardProps` interface (unchanged):

```ts
interface AlertCardProps {
  cardRef: React.RefObject<HTMLDivElement | null>;
  severity: Severity;
  displaySubject: string;
  displaySender: string;
  displayRecipient: string;
  formattedDate: string;
  bodyHtml: string;
  logoDataUrl: string | null;
}
```

### Files

```
src/renderer/src/tabs/
  alertStyles/
    AlertCardClassic.tsx      (extracted from current AlertCard)
    AlertCardMinimal.tsx
    AlertCardCompact.tsx
    AlertCardBanner.tsx
    AlertCardSidebar.tsx
    AlertCardCorporate.tsx
    AlertCardBordered.tsx
    AlertCardSplit.tsx
    index.ts                  (exports ALERT_STYLES array)
  AlertStyleCarousel.tsx      (nav bar + renders active style)
```

### Style Registry

```ts
// alertStyles/index.ts
export const ALERT_STYLES = [
  { id: 'classic', name: 'Classic', component: AlertCardClassic },
  { id: 'minimal', name: 'Minimal', component: AlertCardMinimal },
  // ...
];
```

### State

- `AlertsTab` holds `styleIndex` (number, default 0)
- `AlertStyleCarousel` receives `styleIndex`, setter, and `AlertCardProps`
- `cardRef` attaches to whichever style component is active
- html2canvas capture and clipboard logic remain unchanged

### CSS

- Each style uses a scoped class prefix (e.g., `.alert-minimal-*`, `.alert-compact-*`)
- Shared base styles (preview panel, scroll wrapper) stay in `components.css`
- All styles use hardcoded light colors only — no CSS variables inside the card, no gradients, no CSS filters
- White logo conversion (`makeWhite`) moves to a shared utility used by any style that places logo on a colored background

## Constraints

- All styles must produce clean PNG via html2canvas
- No dark mode styles
- No CSS filters, no transparency-dependent shadows, no gradients
- Flat severity colors from `SEVERITY_COLORS`
- Minimum card width 640px for capture consistency
