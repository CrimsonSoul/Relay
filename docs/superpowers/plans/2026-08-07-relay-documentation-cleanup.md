# Relay Living Documentation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Relay's historical documentation archive and stale overview material with ten verified living Markdown documents and a current, smaller screenshot gallery.

**Architecture:** Preserve the existing product, architecture, development, design, security, Wiki, and Relay Web subject boundaries while making each retained file authoritative for only its named concern. Verify claims from current implementation, configuration, tests, and workflows; delete completed plans, specs, the disconnected prototype, duplicated narration, and unreferenced screenshots. Git history is the only archive.

**Tech Stack:** Markdown, Git, Node.js 22, Prettier, Electron 42, Playwright, and the existing isolated Relay screenshot harness.

## Global Constraints

- Change documentation and documentation assets only; do not change Relay behavior, runtime configuration, source, tests, or live app data.
- Treat current implementation, configuration, focused tests, and workflow definitions as authoritative over prose.
- Preserve unrelated worktree changes and inspect `git status --short --branch` before every commit.
- Keep the ten living Markdown documents named in the approved design with stable subject boundaries.
- Delete `docs/superpowers/specs/`, `docs/superpowers/plans/`, and `docs/ui-mockups/full-redesign/` in the final task.
- Generate screenshots only through `tests/e2e/redesign-screenshots.spec.ts` and its disposable data.
- If the screenshot harness cannot produce validated captures, remove the README gallery and obsolete screenshot assets instead of retaining stale images.
- Do not commit generated `tmp/` content, app data, credentials, tokens, or scanner output.
- Do not push or open a pull request; publication uses the repository's separate `origin/test` workflow.

## File Map

**Retain and update as needed:**

- `AGENTS.md`: repository working, verification, safety, and publication rules
- `PRODUCT.md`: durable product audience, purpose, personality, and design principles
- `README.md`: product overview, feature map, setup, commands, and preview
- `docs/README.md`: living-documentation index
- `docs/architecture.md`: runtime, data ownership, subsystem, storage, and window boundaries
- `docs/DEVELOPMENT.md`: contributor patterns, commands, testing, screenshots, and scanner entry points
- `docs/DESIGN.md`: reusable renderer visual and interaction rules
- `docs/SECURITY.md`: trust boundaries, controls, secret handling, resilience, and security policy
- `docs/knowledge-base.md`: Wiki operator and administrator procedures
- `docs/relay-web.md`: Relay Web operator setup, supported behavior, and network boundary

**Regenerate or delete:**

- Keep: `docs/screenshots/compose.png`, `alerts.png`, `oncall.png`, `knowledge.png`, `cloud-status.png`, and `radar.png`
- Delete every other tracked file in `docs/screenshots/` after the six kept captures are validated

**Delete after living-doc work is complete:**

- `docs/superpowers/specs/`
- `docs/superpowers/plans/`
- `docs/ui-mockups/full-redesign/`

---

### Task 1: Refresh the overview, documentation index, and screenshot gallery

**Files:**

- Modify: `README.md`
- Modify only if a durable statement is contradicted: `PRODUCT.md`
- Modify: `docs/README.md`
- Replace/create: the six kept screenshot files
- Delete: `data-manager.png`, `oncall-popout.png`, `people.png`, `servers.png`, `settings-modal.png`, and `toast.png`

**Interfaces:**

- Consumes: `package.json`, `.node-version`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/App.tsx`, and `tests/e2e/redesign-screenshots.spec.ts`
- Produces: the canonical product overview and screenshot filename set used by later documentation

- [ ] **Step 1: Verify overview inputs**

Run:

```bash
git status --short --branch
node -e 'const p=require("./package.json"),l=require("./package-lock.json"); console.log({node:require("fs").readFileSync(".node-version","utf8").trim(),electron:l.packages["node_modules/electron"].version,react:l.packages["node_modules/react"].version,typescript:l.packages["node_modules/typescript"].version,scripts:Object.keys(p.scripts).sort()})'
sed -n '30,50p' src/renderer/src/components/Sidebar.tsx
rg -n "shot:|'[a-z-]+\\.png'" tests/e2e/redesign-screenshots.spec.ts
```

Expected: Node `22`; Electron `42.4.0`; React `19.2.8`; TypeScript `6.0.3`; sidebar order Compose, Alerts, On-Call, Knowledge, Status, Problems, Radar; harness outputs for all six kept screenshots.

- [ ] **Step 2: Build and generate disposable screenshot output**

Run:

```bash
npm run build
npx playwright test tests/e2e/redesign-screenshots.spec.ts -c playwright.electron.config.ts
```

Expected: both exit `0`; `tmp/redesign-shots/` contains `compose.png`, `alerts.png`, `oncall.png`, `knowledge.png`, `cloud-status.png`, and `radar.png`.

- [ ] **Step 3: Visually validate the six captures**

Open each selected file with the local image viewer at original detail. Confirm that it shows the named current workspace, uses disposable/demo data, has no accidental tooltip or overlay, contains no real credential or connection secret, and is legible. If generation or inspection fails, remove the entire README Preview section and all tracked `docs/screenshots/` files; do not substitute live-data captures.

- [ ] **Step 4: Install the validated screenshot set**

Run:

```bash
cp tmp/redesign-shots/compose.png docs/screenshots/compose.png
cp tmp/redesign-shots/alerts.png docs/screenshots/alerts.png
cp tmp/redesign-shots/oncall.png docs/screenshots/oncall.png
cp tmp/redesign-shots/knowledge.png docs/screenshots/knowledge.png
cp tmp/redesign-shots/cloud-status.png docs/screenshots/cloud-status.png
cp tmp/redesign-shots/radar.png docs/screenshots/radar.png
git rm docs/screenshots/data-manager.png docs/screenshots/oncall-popout.png docs/screenshots/people.png docs/screenshots/servers.png docs/screenshots/settings-modal.png docs/screenshots/toast.png
```

Expected: `docs/screenshots/` contains exactly the six selected PNG files.

- [ ] **Step 5: Rewrite the overview and index with `apply_patch`**

Make these exact content changes:

- README Snapshot names all seven top-level destinations and identifies Wiki, Contacts, and Servers as nested Knowledge destinations.
- Core Features includes Dispatcher Radar and retains only current behavior confirmed in source.
- Preview has two three-column rows: Compose, Alerts, On-Call, Knowledge, Service Status, Dispatcher Radar.
- Docs describes `docs/README.md` as the living index and contains no historical-material wording.
- Screenshot Refresh copies only the six kept filenames emitted by the harness.
- Quick Start and Common Commands contain only current `package.json` scripts.
- `docs/README.md` lists only the six living guides and screenshot assets; delete the historical/exploratory section.
- Change `PRODUCT.md` only if current source contradicts its audience, purpose, or durable principles.

- [ ] **Step 6: Verify and commit Task 1**

Run:

```bash
npx prettier --check README.md PRODUCT.md docs/README.md
git diff --check
git status --short --branch
git add README.md PRODUCT.md docs/README.md docs/screenshots
git diff --cached --check
git commit -m "docs: refresh Relay overview and screenshots"
```

Expected: one commit containing only overview/index/screenshot changes.

---

### Task 2: Refocus architecture on current runtime boundaries

**Files:**

- Modify: `docs/architecture.md`

**Interfaces:**

- Consumes: dependency locks, `src/main/`, `src/preload/`, `src/shared/`, `src/renderer/src/App.tsx`, `Sidebar.tsx`, `src/main/web/`, and `CollectionBootstrap.ts`
- Produces: the canonical runtime and data-ownership description

- [ ] **Step 1: Verify architecture anchors**

Run:

```bash
git status --short --branch
node -e 'const l=require("./package-lock.json"); for(const n of ["electron","react","typescript","vite","electron-vite","pocketbase","zod","vitest","@playwright/test"]) console.log(n,l.packages[`node_modules/${n}`]?.version)'
sed -n '32,46p' src/renderer/src/components/Sidebar.tsx
rg -n "cloud_status_snapshot|cloud_status_mist_snapshot|knowledge_documents|relay_privileged_state|relay_privileged_commands" src/main/pocketbase/CollectionBootstrap.ts
```

Expected: every retained version, tab, collection, and layer has a repository anchor.

- [ ] **Step 2: Rewrite `docs/architecture.md` with `apply_patch`**

Retain Stack, Runtime Model, Data Flow, Main Process Subsystems, Renderer Structure, Storage Model, Windowing, and Security Touchpoints. Apply these changes:

- List all seven primary tabs and keep Wiki, Contacts, and Servers explicitly nested under Knowledge.
- Keep Relay Web, Radar, status compatibility partitions, offline replay, protected identity, and managed Wiki as architectural boundaries.
- Explain ownership and data flow; move procedures to operator guides and detailed controls to Security.
- Reduce roster migration to its compatibility invariant and source pointer.
- Reduce Wiki upload/search/cover narration to authority, data path, failure isolation, cache ownership, and source pointers.
- Keep the collection table representative and name `CollectionBootstrap.ts` as exhaustive.
- Remove rollout history and claims without current source or test evidence.

- [ ] **Step 3: Verify and commit Task 2**

Run:

```bash
for p in src/main/index.ts src/main/app/pocketbaseBootstrap.ts src/main/pocketbase/PocketBaseProcess.ts src/main/pocketbase/CollectionBootstrap.ts src/renderer/src/App.tsx src/renderer/src/services/pocketbase.ts src/renderer/src/stores/collectionStore.ts src/shared/ipc.ts; do test -e "$p" || exit 1; done
npx prettier --check docs/architecture.md
git diff --check
git status --short --branch
git add docs/architecture.md
git diff --cached --check
git commit -m "docs: align Relay architecture with current runtime"
```

---

### Task 3: Make development guidance executable and nonduplicative

**Files:**

- Modify: `docs/DEVELOPMENT.md`

**Interfaces:**

- Consumes: `package.json`, `.node-version`, ESLint/Vitest/Playwright configs, workflows, and current source patterns
- Produces: the canonical contributor workflow and test-command guide

- [ ] **Step 1: Verify contributor entry points**

Run:

```bash
git status --short --branch
node -e 'const p=require("./package.json"); for(const n of ["dev","build","typecheck","lint","format:check","test","test:unit","test:cache","test:renderer","test:electron","test:web","test:coverage","test:knowledge-upload-soak","security:sonar:ci","security:snyk:ci"]) {if(!p.scripts[n]) throw new Error(`missing ${n}`); console.log(n,p.scripts[n])}'
for p in eslint.config.js vitest.config.ts vitest.cache.config.ts vitest.renderer.config.ts playwright.electron.config.ts tests/e2e/redesign-screenshots.spec.ts .github/workflows/security.yml; do test -e "$p" || exit 1; done
```

- [ ] **Step 2: Rewrite `docs/DEVELOPMENT.md` with `apply_patch`**

Retain directory orientation, data and IPC patterns, connection/realtime/offline behavior, renderer conventions, test suites, linting, and contributor rules. Apply these changes:

- Keep executable commands and required environment-variable names.
- Keep the four scanner outcomes and the rule that unavailable is not clean.
- Point detailed gate policy to the security workflow, scanner scripts, and Security guide.
- Remove exact reviewed-finding counts, completed reconciliation narration, CodeRabbit allowance tactics, paid-plan commentary, and duplicate timeout internals.
- Update Screenshot Refresh to copy only the six kept files.
- Replace renamed or obsolete source paths with current paths.

- [ ] **Step 3: Verify and commit Task 3**

Run:

```bash
npx prettier --check docs/DEVELOPMENT.md
git diff --check
git status --short --branch
git add docs/DEVELOPMENT.md
git diff --cached --check
git commit -m "docs: streamline Relay contributor guidance"
```

---

### Task 4: Convert design history into reusable rules

**Files:**

- Modify: `docs/DESIGN.md`

**Interfaces:**

- Consumes: `PRODUCT.md`, theme/style files, shared tab-chrome components, and renderer tests
- Produces: the canonical visual, interaction, responsive, and accessibility rules

- [ ] **Step 1: Verify design-system sources**

Run:

```bash
git status --short --branch
for p in src/renderer/src/styles/theme.css src/renderer/src/styles/components.css src/renderer/src/styles/tab-chrome.css src/renderer/src/styles/utilities.css src/renderer/src/components/tab-chrome/TabChrome.tsx src/renderer/src/components/TactileButton.tsx src/renderer/src/theme/accent.ts; do test -e "$p" || exit 1; done
rg -n -- "--accent|--alarm|--sidebar-width-collapsed|--header-height|--text-display" src/renderer/src/styles/theme.css
rg -n "ACCENT_SCHEMES|ACCENT_SCHEDULE_SLOTS|America/Chicago" src/renderer/src/theme/accent.ts
```

- [ ] **Step 2: Rewrite `docs/DESIGN.md` with `apply_patch`**

Retain Accent Ink principles, hierarchy, shared tab chrome, surface rules, accent/semantic separation, controls, typography, Alerts exported-content exemption, Knowledge interaction boundaries, compact navigation, accessibility, and layout tokens. Apply these changes:

- Keep feature content only when it protects a reusable interaction or exported-content contract.
- Condense Compose, Alerts, search-result, and Knowledge behavior into interaction-contract examples rather than release narratives.
- Remove the Juniper Mist row-placement section; provider composition belongs to architecture and current UI source.
- Remove superseded-style history except for live compatibility constraints.
- Verify token names, values, breakpoints, tab counts, shortcuts, and component paths.

- [ ] **Step 3: Verify and commit Task 4**

Run:

```bash
npx prettier --check docs/DESIGN.md
git diff --check
git status --short --branch
git add docs/DESIGN.md
git diff --cached --check
git commit -m "docs: refocus Relay design guidance"
```

---

### Task 5: Refocus security guidance on enforced boundaries

**Files:**

- Modify: `docs/SECURITY.md`

**Interfaces:**

- Consumes: Electron security configuration, validation, Relay Web security, privileged commands, Wiki file handling, scanner workflows, and focused tests
- Produces: the canonical security model and developer security policy

- [ ] **Step 1: Verify security anchors**

Run:

```bash
git status --short --branch
for p in electron-builder.yml src/main/app/windowFactory.ts src/main/app/securityHeaders.ts src/main/utils/trustedSender.ts src/shared/ipcValidation.ts src/shared/urlSecurity.ts src/main/web/WebRequestSecurity.ts src/main/privileged/PrivilegedCommandProcessor.ts src/main/knowledge/KnowledgePdfService.ts .github/workflows/security.yml; do test -e "$p" || exit 1; done
rg -n "assertTrustedIpcSender|contextIsolation|nodeIntegration|sandbox" src/main src/preload
rg -n "Build quality gate|SonarQube quality gate|Snyk security gate" .github/workflows AGENTS.md
```

- [ ] **Step 2: Rewrite `docs/SECURITY.md` with `apply_patch`**

Retain Trust Boundaries, Runtime Hardening, Validation and Rate Limiting, Automated Gates, Secrets and Local Data, Backups/Sync/Resilience, Developer Rules, and Reporting Issues. Apply these changes:

- Keep current main/preload/renderer/Relay Web boundaries and network-confidentiality warnings.
- Keep enforced controls and their implementation files.
- Keep required scanners, the four result classes, and the rule that unavailable is not clean.
- Remove historical finding counts, reconciliation-campaign narration, CodeRabbit consumption tactics, paid-tier commentary, and duplicated scanner operation.
- Keep migration and Wiki security invariants while linking operator procedures and architecture to their owning guides.
- Verify rate-limit coverage from call sites, not bucket declarations.
- Preserve secret storage, URL redaction, backup, offline replay, and private-reporting rules.

- [ ] **Step 3: Verify and commit Task 5**

Run:

```bash
npx prettier --check docs/SECURITY.md
git diff --check
git status --short --branch
git add docs/SECURITY.md
git diff --cached --check
git commit -m "docs: tighten Relay security guidance"
```

---

### Task 6: Verify and update Wiki and Relay Web operator guidance

**Files:**

- Modify when required: `docs/knowledge-base.md`
- Modify when required: `docs/relay-web.md`

**Interfaces:**

- Consumes: Knowledge management UI/services/tests, privileged administration UI/services/tests, Relay Web settings/server/session/routes/tests, and shared schemas
- Produces: current task-oriented operator guidance with no implementation history

- [ ] **Step 1: Verify Wiki facts**

Run:

```bash
git status --short --branch
rg -n "50 MiB|1000|100 files|4 MiB|eight|seven days|365" src/shared/knowledge.ts src/main/knowledge src/renderer/src/features/knowledge
rg -n "Add Publisher|Assign Publisher|Replace Publisher|SETUP NEEDED|Manage Wiki|SOP Manual|Quick Guide|Pause all|Resume all|Delete permanently" src/renderer/src/components/settings src/renderer/src/features/knowledge
rg -n "Owner|Administrator|Publisher|knowledge.manage" src/main/privileged src/main/knowledge src/shared
```

Expected: every retained role, label, limit, and recovery action has a current implementation or test anchor.

- [ ] **Step 2: Verify Relay Web facts**

Run:

```bash
rg -n "1024|Chrome|Edge|Safari|one hour|eight hours|Direct LAN|Relay Web" src/main/web src/renderer/src/components tests/web/relay-web.spec.ts
rg -n "offline|service worker|Radar|clipboard|backup|restore|notification" src/main/web src/renderer/src/runtime docs/relay-web.md
```

- [ ] **Step 3: Patch only operator-relevant discrepancies**

Correct mismatched menu labels, roles, actions, limits, retry behavior, retention periods, offline rules, browser limitations, and session durations. Keep ordered procedures and irreversible-action warnings; remove mechanics that do not change an operator decision. Leave a guide unchanged when all statements are current and useful.

- [ ] **Step 4: Verify and commit Task 6 if needed**

Run:

```bash
npx prettier --check docs/knowledge-base.md docs/relay-web.md
git diff --check
git status --short --branch
```

If either file changed:

```bash
git add docs/knowledge-base.md docs/relay-web.md
git diff --cached --check
git commit -m "docs: update Relay operator guidance"
```

If neither changed, record the verification and omit an empty commit.

---

### Task 7: Delete historical material and run the complete audit

**Files:**

- Delete: `docs/superpowers/specs/`
- Delete: `docs/superpowers/plans/`
- Delete: `docs/ui-mockups/full-redesign/`
- Verify: all ten retained Markdown documents and six screenshot assets

**Interfaces:**

- Consumes: every deliverable from Tasks 1-6 and the approved design
- Produces: the final living-only documentation tree and completion evidence

- [ ] **Step 1: Confirm exact deletion targets**

Run:

```bash
git status --short --branch
git ls-files 'docs/superpowers/specs/*.md' | wc -l
git ls-files 'docs/superpowers/plans/*.md' | wc -l
git ls-files 'docs/ui-mockups/full-redesign/*'
```

Expected: no unrelated changes and only the three approved targets are in scope.

- [ ] **Step 2: Delete the archive and prototype**

Run:

```bash
git rm -r docs/superpowers/specs docs/superpowers/plans docs/ui-mockups/full-redesign
```

Expected: this plan and the approved design are deleted with older records; no source, test, workflow, or living-guide path is removed.

- [ ] **Step 3: Prove the exact retained Markdown inventory**

Run:

```bash
git ls-files '*.md' | sort
git ls-files '*.md' | wc -l
```

Expected list and count `10`:

```text
AGENTS.md
PRODUCT.md
README.md
docs/DESIGN.md
docs/DEVELOPMENT.md
docs/README.md
docs/SECURITY.md
docs/architecture.md
docs/knowledge-base.md
docs/relay-web.md
```

- [ ] **Step 4: Prove every relative Markdown link resolves**

Run:

```bash
node <<'NODE'
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const docs = cp.execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const failures = [];
for (const file of docs) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1];
    const target = raw.split('#')[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), decodeURIComponent(target)))) failures.push(`${file}: ${raw}`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`local_links_ok=${docs.length}`);
NODE
```

Expected: `local_links_ok=10`.

- [ ] **Step 5: Prove every documented npm script exists**

Run:

```bash
node <<'NODE'
const fs = require('fs');
const cp = require('child_process');
const scripts = require('./package.json').scripts;
const docs = cp.execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const failures = [];
for (const file of docs) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) if (!scripts[match[1]]) failures.push(`${file}: npm run ${match[1]}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('npm_script_refs_ok');
NODE
```

Expected: `npm_script_refs_ok`.

- [ ] **Step 6: Prove referenced repository paths exist or are documented generated paths**

Run:

```bash
node <<'NODE'
const fs = require('fs');
const cp = require('child_process');
const docs = cp.execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const exact = new Set(['package.json', 'package-lock.json', '.node-version', 'eslint.config.js', 'electron-builder.yml', 'electron.vite.config.ts', 'playwright.electron.config.ts', 'sonar-project.properties', 'vitest.config.ts', 'vitest.cache.config.ts', 'vitest.renderer.config.ts']);
const generated = /^(resources\/pocketbase\/(win32|darwin|linux)|resources\/pocketbase\/pocketbase|pocketbase\/hooks|<config data>\/)/;
const failures = [];
for (const file of docs) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    let value = match[1].replace(/:\d+(?::\d+)?$/, '').replace(/\/$/, '');
    if (/\s|[<>*|]/.test(value) || generated.test(value)) continue;
    if (!/^(src|docs|scripts|tests|resources|\.github)\//.test(value) && !exact.has(value)) continue;
    if (!fs.existsSync(value)) failures.push(`${file}: ${match[1]}`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('repo_path_refs_ok');
NODE
```

Expected: `repo_path_refs_ok`.

- [ ] **Step 7: Prove versions, navigation, screenshots, and deletions**

Run:

```bash
node -e 'const l=require("./package-lock.json"); console.log(require("fs").readFileSync(".node-version","utf8").trim(),l.packages["node_modules/electron"].version,l.packages["node_modules/react"].version,l.packages["node_modules/typescript"].version)'
rg -n "Compose|Alerts|On-Call|Knowledge|Status|Problems|Radar" README.md docs/architecture.md docs/DESIGN.md
find docs/screenshots -maxdepth 1 -type f -print | sort
test ! -e docs/superpowers/specs
test ! -e docs/superpowers/plans
test ! -e docs/ui-mockups/full-redesign
```

Expected: current versions; all seven navigation labels where relevant; exactly six screenshot files; all deleted paths absent.

- [ ] **Step 8: Run final formatting and diff checks**

Run:

```bash
npx prettier --check AGENTS.md PRODUCT.md README.md docs/README.md docs/architecture.md docs/DEVELOPMENT.md docs/DESIGN.md docs/SECURITY.md docs/knowledge-base.md docs/relay-web.md
git diff --check
git status --short --branch
```

Expected: checks pass and only archive/prototype deletions remain at this task boundary.

- [ ] **Step 9: Commit deletion and rerun post-commit checks**

Run:

```bash
git add -u docs/superpowers docs/ui-mockups/full-redesign
git diff --cached --check
git commit -m "docs: remove historical documentation archive"
git status --short --branch
git log --oneline --decorate origin/test..HEAD
git diff --stat origin/test...HEAD
git diff --check origin/test...HEAD
npx prettier --check AGENTS.md PRODUCT.md README.md docs/README.md docs/architecture.md docs/DEVELOPMENT.md docs/DESIGN.md docs/SECURITY.md docs/knowledge-base.md docs/relay-web.md
```

Expected: clean branch; only approved cleanup commits; no aggregate whitespace errors; all retained Markdown passes Prettier.
