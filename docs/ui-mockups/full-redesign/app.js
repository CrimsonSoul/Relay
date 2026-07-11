const workspace = document.querySelector('#workspace');
const navItems = [...document.querySelectorAll('[data-screen]')];
const statusMessage = document.querySelector('#statusMessage');
const commandOverlay = document.querySelector('#commandOverlay');
const commandTrigger = document.querySelector('#commandTrigger');
const commandInput = document.querySelector('#commandInput');
const settingsButton = document.querySelector('#settingsButton');
const settingsDrawer = document.querySelector('#settingsDrawer');
const settingsBackdrop = document.querySelector('#settingsBackdrop');
const toast = document.querySelector('#toast');
let activeScreen = 'compose';
let toastTimer;

const icon = (name) => `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;

const people = [
  ['IC', 'Ian Clark', 'SRE · Primary on-call', 'ian.clark@relay.local', '555-0108', 'SRE'],
  ['KR', 'Kyle Reese', 'Incident Commander', 'kyle.reese@relay.local', '555-0110', 'Operations'],
  [
    'AJ',
    'Alice Johnson',
    'Senior Platform Engineer',
    'alice.johnson@relay.local',
    '555-0100',
    'Platform',
  ],
  ['BS', 'Bob Smith', 'DevOps Lead', 'bob.smith@relay.local', '555-0101', 'DevOps'],
  ['DP', 'Diana Prince', 'Security Engineer', 'diana.prince@relay.local', '555-0103', 'Security'],
  ['EW', 'Evan Wright', 'Database Administrator', 'evan.wright@relay.local', '555-0104', 'Data'],
  [
    'SR',
    'Steve Rogers',
    'Engineering Team Lead',
    'steve.rogers@relay.local',
    '555-0118',
    'Platform',
  ],
];

const servers = [
  [
    'DB',
    'db-primary-01',
    'Production',
    'Data Services',
    'Evan Wright',
    'Linux',
    'Healthy',
    '99.99%',
  ],
  ['WB', 'web-prod-01', 'Production', 'Storefront', 'Alice Johnson', 'Linux', 'Healthy', '99.97%'],
  ['WB', 'web-prod-02', 'Production', 'Storefront', 'Alice Johnson', 'Linux', 'Healthy', '99.95%'],
  ['CA', 'cache-cluster', 'Production', 'Platform', 'Bob Smith', 'Linux', 'Degraded', '98.71%'],
  ['CI', 'ci-runner-04', 'Internal', 'DevOps', 'Kyle Reese', 'Linux', 'Healthy', '99.82%'],
  ['BA', 'bastion-host', 'Production', 'Security', 'Diana Prince', 'Linux', 'Healthy', '100.0%'],
  ['BK', 'backup-server', 'Production', 'IT Ops', 'Kyle Reese', 'Windows', 'Healthy', '99.91%'],
];

const notes = [
  {
    id: 1,
    tag: 'RUNBOOK',
    age: '8m',
    title: 'Payments degradation — first checks',
    body: '1. Confirm gateway latency in Dynatrace.\n2. Check cache-cluster saturation.\n3. Page Data Services if p95 exceeds 1.8s.',
  },
  {
    id: 2,
    tag: 'HANDOFF',
    age: '31m',
    title: 'Swing shift handoff',
    body: 'Watch INC-2847 through the next deployment window. Customer support has approved the draft language.',
  },
  {
    id: 3,
    tag: 'CONTACT',
    age: '1h',
    title: 'Vendor escalation path',
    body: 'Gateway operations: 1-800-555-0142\nAccount code: OPS-1047\nAsk for Severity 1 bridge.',
  },
  {
    id: 4,
    tag: 'DRAFT',
    age: '2h',
    title: 'Maintenance notification',
    body: 'Planned network maintenance will affect checkout authorization between 02:00 and 03:00 CT.',
  },
  {
    id: 5,
    tag: 'CHECKLIST',
    age: '5h',
    title: 'Bridge closeout',
    body: 'Confirm owner, send resolution, close vendor bridge, attach timeline, and schedule the follow-up review.',
  },
  {
    id: 6,
    tag: 'REFERENCE',
    age: '1d',
    title: 'Production service aliases',
    body: 'PAY-GW → payment-gateway\nCUST-API → customer-profile\nORD-EVT → order-events',
  },
];

function screenHeader(title, description, actions = '') {
  return `
    <header class="screen-header">
      <div class="screen-title">
        <h1>${title}</h1>
        <p>${description}</p>
      </div>
      <div class="header-actions">${actions}</div>
    </header>`;
}

function composeScreen() {
  const recipients = people.slice(0, 6);
  return `
    <section class="screen screen--compose" aria-labelledby="compose-title">
      ${screenHeader(
        '<span id="compose-title">Bridge assembly</span>',
        'Build a verified recipient set, then start or schedule the bridge without leaving context.',
        `<button class="button button--ghost" type="button" data-toast="Bridge history opened">History</button>
         <button class="button button--secondary" type="button" data-toast="Recipient changes reset">Reset changes</button>`,
      )}
      <div class="workspace-body">
        <div class="compose-grid">
          <aside class="panel source-panel" aria-label="Recipient sources">
            <div class="panel-header"><h2>Recipient sources</h2><span id="groupSelectedCount">2 selected</span></div>
            <div class="source-search"><input class="input" type="search" placeholder="Filter groups…" aria-label="Filter groups" /></div>
            <div class="source-list">
              ${[
                ['SRE on-call', 'Current rotation', 3, true],
                ['Core Engineering', 'Saved group', 4, true],
                ['DevOps', 'Saved group', 4, false],
                ['Leadership', 'Saved group', 3, false],
                ['Security response', 'Current rotation', 2, false],
                ['Product Team', 'Saved group', 3, false],
              ]
                .map(
                  ([name, type, count, selected]) => `
                    <button class="group-row${selected ? ' is-selected' : ''}" type="button" aria-pressed="${selected}">
                      <span class="group-check">${icon('check')}</span>
                      <span class="group-meta"><strong>${name}</strong><small>${type}</small></span>
                      <span class="group-size">${count}</span>
                    </button>`,
                )
                .join('')}
            </div>
            <div class="panel-toolbar" style="padding:10px;border-top:1px solid var(--line)">
              <button class="button button--ghost button--full" type="button" data-toast="Group manager opened">${icon('plus')} Manage groups</button>
            </div>
          </aside>

          <section class="panel recipient-panel" aria-label="Selected recipients">
            <div class="panel-header">
              <h2>Selected recipients</h2>
              <div class="panel-toolbar"><span>Sorted by role</span><button class="button button--ghost" type="button" data-toast="Add person opened">${icon('plus')} Add person</button></div>
            </div>
            <div class="recipient-table-wrap">
              <table class="data-table recipient-table">
                <thead><tr><th style="width:38%">Person</th><th style="width:27%">Source</th><th style="width:24%">Reach</th><th style="width:11%"></th></tr></thead>
                <tbody>
                  ${recipients
                    .map(
                      (person, index) => `
                      <tr${index === 0 ? ' class="is-selected"' : ''}>
                        <td><div class="person-cell"><span class="avatar">${person[0]}</span><span><strong>${person[1]}</strong><small>${person[2]}</small></span></div></td>
                        <td><span class="recipient-source">${index < 2 ? 'SRE on-call' : 'Core Engineering'}</span></td>
                        <td><span class="mono">${person[4]}</span></td>
                        <td><button class="icon-button" type="button" aria-label="More options">${icon('more')}</button></td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
            <div class="recipient-actions">
              <div class="recipient-summary"><strong><span id="recipientCount">7</span> recipients ready</strong><small>6 directory records · 1 manual address</small></div>
              <div class="button-row">
                <button class="button button--secondary" type="button" data-toast="Recipient addresses copied">${icon('copy')} Copy</button>
                <button class="button button--secondary" type="button" data-toast="Bridge scheduler opened">${icon('clock')} Schedule</button>
                <button class="button button--primary" type="button" data-toast="Outlook bridge draft created">Start bridge ${icon('chevron')}</button>
              </div>
            </div>
          </section>

          <aside class="panel readiness-panel" aria-label="Bridge readiness">
            <div class="panel-header"><h2>Bridge readiness</h2><div class="readiness-score"><b>92</b><span>/100</span></div></div>
            <div class="readiness-list">
              ${[
                ['Recipient coverage', 'Primary and escalation paths included', true],
                ['Duplicate check', 'No duplicate addresses detected', true],
                ['Bridge owner', 'Kyle Reese · Incident Commander', true],
                ['Calendar details', 'Add an end time before scheduling', false],
              ]
                .map(
                  ([title, copy, ready]) => `
                  <div class="readiness-item">
                    <span class="readiness-item__icon${ready ? '' : ' readiness-item__icon--pending'}">${ready ? icon('check') : '!'}</span>
                    <div><strong>${title}</strong><small>${copy}</small></div>
                  </div>`,
                )
                .join('')}
            </div>
            <div class="activity-block">
              <h3>Recent bridge activity</h3>
              <div class="activity-line"><time>09:32</time><span>Added SRE on-call</span></div>
              <div class="activity-line"><time>09:34</time><span>Removed former rotation</span></div>
              <div class="activity-line"><time>09:38</time><span>Owner set to Kyle Reese</span></div>
            </div>
          </aside>
        </div>
      </div>
    </section>`;
}

function alertsScreen() {
  return `
    <section class="screen screen--alerts" aria-labelledby="alerts-title">
      ${screenHeader(
        '<span id="alerts-title">Alert studio</span>',
        'Compose one operational message and export a validated artifact for Outlook.',
        `<button class="button button--ghost" type="button" data-toast="Alert templates opened">Templates</button>
         <button class="button button--secondary" type="button" data-toast="Alert history opened">History</button>`,
      )}
      <div class="workspace-body">
        <div class="alerts-workspace">
          <section class="panel alert-form-panel" aria-label="Alert fields">
            <div class="panel-header"><h2>Message controls</h2><span>Draft saved 12 sec ago</span></div>
            <div class="alert-form-scroll">
              <div class="form-section">
                <div class="form-section-title"><h3>Posture</h3><span class="state-pill state-pill--danger"><i></i> Action required</span></div>
                <div class="severity-grid" role="radiogroup" aria-label="Alert severity">
                  <button class="severity-option is-selected" style="--severity-color:var(--danger)" data-severity="critical" type="button"><i></i>Critical</button>
                  <button class="severity-option" style="--severity-color:var(--warn)" data-severity="major" type="button"><i></i>Major</button>
                  <button class="severity-option" style="--severity-color:var(--info)" data-severity="minor" type="button"><i></i>Minor</button>
                  <button class="severity-option" style="--severity-color:var(--good)" data-severity="resolved" type="button"><i></i>Resolved</button>
                </div>
              </div>
              <div class="form-section field-stack">
                <div class="form-section-title"><h3>Message</h3><span>121 / 500</span></div>
                <label><span class="field-label">Title</span><input class="input" id="alertTitleInput" value="Payment processing delays" /></label>
                <label><span class="field-label">Customer-facing update</span><textarea class="textarea" id="alertBodyInput">We are investigating elevated payment authorization times. Orders remain available, but some customers may need to retry checkout.</textarea></label>
                <div class="field-grid">
                  <label><span class="field-label">Started</span><input class="input mono" value="Today · 09:24 CT" /></label>
                  <label><span class="field-label">Next update</span><input class="input mono" value="10:15 CT" /></label>
                </div>
              </div>
              <div class="form-section field-stack">
                <div class="form-section-title"><h3>Delivery</h3><span>2 channels ready</span></div>
                <div class="delivery-chips">
                  <button class="delivery-chip is-selected" type="button">${icon('check')} Outlook draft</button>
                  <button class="delivery-chip is-selected" type="button">${icon('check')} Copy image</button>
                  <button class="delivery-chip" type="button">Alert alarm</button>
                  <button class="delivery-chip" type="button">Save PNG</button>
                </div>
                <label><span class="field-label">Click-through URL</span><input class="input" value="https://status.company.net/incidents/inc-2847" /></label>
                <div class="field-grid">
                  <label><span class="field-label">Business area</span><input class="input" value="Digital Commerce" /></label>
                  <label><span class="field-label">Audience</span><input class="input" value="All support teams" /></label>
                </div>
              </div>
            </div>
            <div class="alert-form-actions"><span class="state-pill state-pill--good">${icon('check')} Required fields complete</span><button class="button button--ghost" type="button" data-toast="Alert draft cleared">Clear draft</button></div>
          </section>

          <section class="panel alert-preview-panel" aria-label="Alert preview">
            <div class="panel-header"><h2>Live preview</h2><div class="segmented"><button class="is-selected" type="button">Desktop</button><button type="button">Compact</button></div></div>
            <div class="alert-preview-canvas">
              <article class="alert-artifact" id="alertArtifact">
                <div class="alert-artifact__rail" id="alertRail"></div>
                <div class="alert-artifact__top"><div class="alert-artifact__brand">relay<span>.</span></div><span class="alert-artifact__severity" id="alertSeverity">Critical incident</span></div>
                <div class="alert-artifact__content">
                  <h2 id="alertPreviewTitle">Payment processing delays</h2>
                  <p id="alertPreviewBody">We are investigating elevated payment authorization times. Orders remain available, but some customers may need to retry checkout.</p>
                  <div class="alert-artifact__meta">
                    <div><small>Started</small><strong>Today · 09:24 CT</strong></div>
                    <div><small>Next update</small><strong>10:15 CT</strong></div>
                    <div><small>Reference</small><strong>INC-2847</strong></div>
                  </div>
                </div>
              </article>
            </div>
            <div class="preview-footer"><span class="muted" style="font-size:9px">1200 × 675 · link embedded in Outlook export</span><div class="button-row"><button class="button button--secondary" type="button" data-toast="Alert image copied">${icon('copy')} Copy image</button><button class="button button--primary" type="button" data-toast="Outlook draft created">Create Outlook draft ${icon('chevron')}</button></div></div>
          </section>
        </div>
      </div>
    </section>`;
}

function oncallScreen() {
  const teams = [
    [
      'SRE',
      'Updated 6m ago',
      [
        ['PRIMARY', 'IC', 'Ian Clark', '555-0108'],
        ['SECONDARY', 'KR', 'Kyle Reese', '555-0110'],
        ['BACKUP', 'BS', 'Bob Smith', '555-0101'],
      ],
    ],
    [
      'Platform',
      'Updated 12m ago',
      [
        ['PRIMARY', 'AJ', 'Alice Johnson', '555-0100'],
        ['SHADOW', 'SR', 'Steve Rogers', '555-0118'],
      ],
    ],
    [
      'Security',
      'Updated 4m ago',
      [
        ['PRIMARY', 'DP', 'Diana Prince', '555-0103'],
        ['ESCALATION', 'TS', 'Tony Stark', '555-0119'],
      ],
    ],
    [
      'Data Services',
      'Updated 19m ago',
      [
        ['PRIMARY', 'EW', 'Evan Wright', '555-0104'],
        ['ESCALATION', 'FL', 'Fiona Lee', '555-0105'],
      ],
    ],
  ];
  return `
    <section class="screen screen--oncall" aria-labelledby="oncall-title">
      ${screenHeader(
        '<span id="oncall-title">On-call board</span>',
        'Current coverage and escalation ownership for the active Central Time shift.',
        `<button class="button button--secondary" type="button" data-toast="On-call board opened in a new window">Open board</button>
         <button class="button button--primary" type="button" data-toast="Rotation editor opened">Edit rotation</button>`,
      )}
      <div class="workspace-body">
        <div class="shift-strip">
          <div class="shift-summary"><span class="shift-summary__signal">${icon('check')}</span><div><strong>Day shift fully covered</strong><small>06:00–14:00 CT · No gaps detected</small></div></div>
          <div class="shift-stat"><small>Active responders</small><strong>8</strong></div>
          <div class="shift-stat"><small>Next handoff</small><strong>04:18:32</strong></div>
          <div class="shift-stat"><small>Last roster sync</small><strong>09:36</strong></div>
        </div>
        <div class="oncall-board">
          ${teams
            .map(
              ([team, updated, responders]) => `
              <section class="team-column">
                <header class="team-column__header"><h2>${team}</h2><span>${updated}</span></header>
                ${responders
                  .map(
                    ([role, initials, name, number]) => `
                    <div class="responder">
                      <span class="avatar responder__avatar">${initials}</span>
                      <span class="responder__identity"><span class="responder__role">${role}</span><strong>${name}</strong><small>${number}</small></span>
                      <button class="responder__call" type="button" aria-label="Call ${name}" data-toast="Calling ${name}">${icon('chevron')}</button>
                    </div>`,
                  )
                  .join('')}
              </section>`,
            )
            .join('')}
        </div>
      </div>
    </section>`;
}

function statusScreen() {
  const providers = [
    ['AWS', 'Amazon Web Services', 'US-East service health', 'Operational', '99.99%', 'good'],
    ['AZ', 'Microsoft Azure', 'North Central US', 'Operational', '99.98%', 'good'],
    ['GW', 'Payment Gateway', 'Authorization API', 'Degraded', '98.71%', 'warn'],
    ['GH', 'GitHub', 'Actions and API', 'Operational', '99.97%', 'good'],
    ['DT', 'Dynatrace', 'Monitoring platform', 'Operational', '100.0%', 'good'],
    ['CL', 'Claude', 'API service', 'Operational', '99.96%', 'good'],
  ];
  return `
    <section class="screen screen--status" aria-labelledby="status-title">
      ${screenHeader(
        '<span id="status-title">Service status</span>',
        'Provider posture and external incidents, ordered by operational impact.',
        `<span class="muted" style="font-size:10px">Updated 42 seconds ago</span><button class="button button--secondary" id="refreshStatus" type="button">Refresh</button>`,
      )}
      <div class="workspace-body">
        <div class="status-overview">
          <div class="posture-primary"><span class="posture-icon">${icon('alerts')}</span><div><span>Current posture</span><strong>1 provider needs attention</strong><small>Payment Gateway is degraded</small></div></div>
          <div class="posture-stat"><span>Impacted providers</span><strong>1 / 6</strong></div>
          <div class="posture-stat"><span>Active incidents</span><strong>2</strong></div>
          <div class="posture-stat"><span>Worst severity</span><strong style="color:var(--warn)">MAJOR</strong></div>
        </div>
        <div class="status-grid">
          <section class="panel provider-list">
            <div class="panel-header"><h2>Provider posture</h2><span>Impacted first</span></div>
            ${providers
              .map(
                ([logo, name, detail, state, uptime, kind]) => `
                <div class="provider-row">
                  <span class="provider-logo">${logo}</span>
                  <span class="provider-name"><strong>${name}</strong><small>${detail}</small></span>
                  <span class="state-pill state-pill--${kind}"><i></i>${state}</span>
                  <span class="provider-uptime">${uptime}</span>
                </div>`,
              )
              .join('')}
          </section>
          <section class="panel incident-feed">
            <div class="panel-header"><h2>Incident feed</h2><div class="segmented"><button class="is-selected" type="button">Active</button><button type="button">Recent</button></div></div>
            <div class="incident-item"><span class="incident-item__signal incident-item__signal--danger"></span><div><strong>Elevated payment authorization times</strong><p>Gateway provider is investigating increased p95 latency in North America.</p><time>09:24 CT · Payment Gateway</time></div></div>
            <div class="incident-item"><span class="incident-item__signal"></span><div><strong>Intermittent checkout retries</strong><p>Internal monitors show a small increase in retry rates; customer impact is limited.</p><time>09:31 CT · Relay monitor</time></div></div>
            <div class="incident-item"><span class="incident-item__signal incident-item__signal--good"></span><div><strong>GitHub Actions delays resolved</strong><p>Hosted runner queue depth has returned to normal.</p><time>08:42 CT · GitHub</time></div></div>
          </section>
        </div>
      </div>
    </section>`;
}

function peopleScreen() {
  return `
    <section class="screen screen--people" aria-labelledby="people-title">
      ${screenHeader(
        '<span id="people-title">People directory</span>',
        'Search operational contacts, understand team context, and add them directly to a bridge.',
        `<button class="button button--secondary" type="button" data-toast="Group manager opened">Manage groups</button>
         <button class="button button--primary" type="button" data-toast="New contact form opened">${icon('plus')} Add contact</button>`,
      )}
      <div class="workspace-body">
        <div class="split-workspace">
          <section class="panel list-panel">
            <div class="list-toolbar"><input class="input" type="search" placeholder="Search name, email, title, or team…" aria-label="Search people" /><div class="segmented"><button class="is-selected" type="button">All</button><button type="button">On-call</button></div></div>
            <div class="list-table-wrap">
              <table class="data-table">
                <thead><tr><th style="width:34%">Person</th><th style="width:27%">Email</th><th style="width:20%">Team</th><th style="width:19%">Reach</th></tr></thead>
                <tbody>
                  ${people
                    .map(
                      (person, index) => `
                      <tr${index === 0 ? ' class="is-selected"' : ''} data-detail-name="${person[1]}">
                        <td><div class="person-cell"><span class="avatar">${person[0]}</span><span><strong>${person[1]}</strong><small>${person[2]}</small></span></div></td>
                        <td>${person[3]}</td><td><span class="tag">${person[5]}</span></td><td class="mono">${person[4]}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </section>
          <aside class="panel detail-panel">
            <div class="detail-hero">
              <div class="detail-hero__top"><span class="avatar detail-avatar">IC</span><div><h2 id="personDetailName">Ian Clark</h2><p>SRE · Primary on-call</p></div></div>
              <span class="state-pill state-pill--good"><i></i> On call until 14:00 CT</span>
              <div class="detail-actions"><button class="button button--primary" type="button" data-toast="Ian Clark added to bridge">Add to bridge</button><button class="button button--secondary" type="button" data-toast="Contact editor opened">Edit contact</button></div>
            </div>
            <section class="detail-section"><h3>Contact</h3><dl class="detail-list"><div><dt>Email</dt><dd>ian.clark@relay.local</dd></div><div><dt>Phone</dt><dd>555-0108</dd></div><div><dt>Location</dt><dd>Chicago, IL · CT</dd></div></dl></section>
            <section class="detail-section"><h3>Membership</h3><div class="tag-row"><span class="tag">SRE</span><span class="tag">Core Engineering</span><span class="tag">Incident command</span></div></section>
            <section class="detail-section"><h3>Operational note</h3><p class="muted" style="margin:0;font-size:9px;line-height:1.55">Primary escalation for payment and platform events. Prefers phone for Sev-1 pages.</p></section>
          </aside>
        </div>
      </div>
    </section>`;
}

function serversScreen() {
  return `
    <section class="screen screen--servers" aria-labelledby="servers-title">
      ${screenHeader(
        '<span id="servers-title">Server inventory</span>',
        'Find service ownership and escalation context without leaving the incident workflow.',
        `<button class="button button--secondary" type="button" data-toast="Inventory exported">Export</button>
         <button class="button button--primary" type="button" data-toast="New server form opened">${icon('plus')} Add server</button>`,
      )}
      <div class="workspace-body">
        <div class="split-workspace">
          <section class="panel list-panel">
            <div class="list-toolbar"><input class="input" type="search" placeholder="Search host, owner, business area, or OS…" aria-label="Search servers" /><div class="segmented"><button class="is-selected" type="button">All</button><button type="button">Production</button><button type="button">Degraded</button></div></div>
            <div class="list-table-wrap">
              <table class="data-table">
                <thead><tr><th style="width:28%">Host</th><th style="width:19%">Environment</th><th style="width:22%">Owner</th><th style="width:16%">Health</th><th style="width:15%">Uptime</th></tr></thead>
                <tbody>
                  ${servers
                    .map(
                      (server, index) => `
                      <tr${index === 0 ? ' class="is-selected"' : ''} data-detail-server="${server[1]}">
                        <td><div class="person-cell"><span class="avatar">${server[0]}</span><span><strong class="mono">${server[1]}</strong><small>${server[3]}</small></span></div></td>
                        <td><span class="tag">${server[2]}</span></td><td>${server[4]}</td>
                        <td><span class="state-pill state-pill--${server[6] === 'Healthy' ? 'good' : 'warn'}"><i></i>${server[6]}</span></td><td class="mono">${server[7]}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </section>
          <aside class="panel detail-panel">
            <div class="detail-hero">
              <div class="detail-hero__top"><span class="avatar detail-avatar">DB</span><div><h2 class="mono" id="serverDetailName">db-primary-01</h2><p>Production · Data Services</p></div></div>
              <span class="state-pill state-pill--good"><i></i> Healthy</span>
              <div class="detail-actions"><button class="button button--primary" type="button" data-toast="Owner and contact added to bridge">Add owners</button><button class="button button--secondary" type="button" data-toast="Server editor opened">Edit record</button></div>
            </div>
            <section class="detail-section"><h3>System</h3><dl class="detail-list"><div><dt>Operating system</dt><dd>Linux · RHEL 9</dd></div><div><dt>Business area</dt><dd>Data Services</dd></div><div><dt>Line of business</dt><dd>Core Data</dd></div><div><dt>Address</dt><dd class="mono">10.42.16.21</dd></div></dl></section>
            <section class="detail-section"><h3>Ownership</h3><dl class="detail-list"><div><dt>Owner</dt><dd>Evan Wright</dd></div><div><dt>Escalation</dt><dd>Laura Croft</dd></div><div><dt>Runbook</dt><dd>DATA-DB-001</dd></div></dl></section>
            <section class="detail-section"><h3>30-day posture</h3><div class="server-health"><span class="health-bar"><span style="width:99%"></span></span><span class="mono dim" style="font-size:9px">99.99% uptime</span></div></section>
          </aside>
        </div>
      </div>
    </section>`;
}

function notesScreen() {
  const selected = notes[0];
  return `
    <section class="screen screen--notes" aria-labelledby="notes-title">
      ${screenHeader(
        '<span id="notes-title">Operations notes</span>',
        'Capture handoffs, runbook fragments, and incident context in one persistent board.',
        `<div class="segmented"><button class="is-selected" type="button">S</button><button type="button">M</button><button type="button">L</button></div>
         <button class="button button--primary" type="button" data-toast="New note created">${icon('plus')} New note</button>`,
      )}
      <div class="workspace-body">
        <div class="notes-layout">
          <section class="panel notes-board-panel" aria-label="Notes board">
            <div class="notes-board">
              ${notes
                .map(
                  (note, index) => `
                  <article class="note-card${index === 0 ? ' is-selected' : ''}" tabindex="0" data-note-id="${note.id}">
                    <div class="note-card__meta"><span>${note.tag}</span><time>${note.age}</time></div>
                    <h3>${note.title}</h3><p>${note.body.replaceAll('\n', '<br>')}</p>
                  </article>`,
                )
                .join('')}
            </div>
          </section>
          <aside class="panel note-editor">
            <div class="panel-header"><h2>Editing note</h2><span>Saved automatically</span></div>
            <div class="editor-toolbar"><button class="editor-tool" type="button">B</button><button class="editor-tool" type="button"><em>I</em></button><button class="editor-tool" type="button">•</button><button class="editor-tool" type="button">1.</button><button class="editor-tool mono" type="button">&lt;/&gt;</button></div>
            <div class="note-editor__body"><input class="note-editor__title input" id="noteTitle" value="${selected.title}" /><textarea class="textarea" id="noteBody">${selected.body}</textarea><div class="tag-row"><span class="tag">RUNBOOK</span><button class="tag" type="button">+ Add tag</button></div></div>
            <div class="note-editor__footer"><button class="button button--danger" type="button" data-toast="Delete requires confirmation">Delete</button><span class="dim" style="font-size:9px">Edited 2 minutes ago</span></div>
          </aside>
        </div>
      </div>
    </section>`;
}

const screens = {
  compose: composeScreen,
  alerts: alertsScreen,
  oncall: oncallScreen,
  status: statusScreen,
  people: peopleScreen,
  servers: serversScreen,
  notes: notesScreen,
};

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function setSegmentedHandlers(scope = document) {
  scope.querySelectorAll('.segmented').forEach((segment) => {
    segment.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        segment.querySelectorAll('button').forEach((item) => item.classList.remove('is-selected'));
        button.classList.add('is-selected');
      });
    });
  });
}

function bindScreenInteractions() {
  workspace.querySelectorAll('[data-toast]').forEach((button) => {
    button.addEventListener('click', () => showToast(button.dataset.toast));
  });
  setSegmentedHandlers(workspace);

  workspace.querySelectorAll('.data-table tbody tr').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      row
        .closest('tbody')
        .querySelectorAll('tr')
        .forEach((item) => item.classList.remove('is-selected'));
      row.classList.add('is-selected');
      if (row.dataset.detailName)
        document.querySelector('#personDetailName').textContent = row.dataset.detailName;
      if (row.dataset.detailServer)
        document.querySelector('#serverDetailName').textContent = row.dataset.detailServer;
    });
  });

  if (activeScreen === 'compose') {
    const rows = [...workspace.querySelectorAll('.group-row')];
    const selectedLabel = workspace.querySelector('#groupSelectedCount');
    const recipientCount = workspace.querySelector('#recipientCount');
    rows.forEach((row) => {
      row.addEventListener('click', () => {
        row.classList.toggle('is-selected');
        row.setAttribute('aria-pressed', row.classList.contains('is-selected'));
        const count = rows.filter((item) => item.classList.contains('is-selected')).length;
        selectedLabel.textContent = `${count} selected`;
        recipientCount.textContent = String(3 + count * 2);
      });
    });
  }

  if (activeScreen === 'alerts') {
    const palette = {
      critical: ['Critical incident', '#ff626a', '#2a1012'],
      major: ['Major incident', '#f0b849', '#2c210d'],
      minor: ['Service advisory', '#70a0ff', '#101b32'],
      resolved: ['Resolved', '#55d58c', '#0e261a'],
    };
    const titleInput = workspace.querySelector('#alertTitleInput');
    const bodyInput = workspace.querySelector('#alertBodyInput');
    const previewTitle = workspace.querySelector('#alertPreviewTitle');
    const previewBody = workspace.querySelector('#alertPreviewBody');
    titleInput.addEventListener('input', () => {
      previewTitle.textContent = titleInput.value || 'Untitled operational update';
    });
    bodyInput.addEventListener('input', () => {
      previewBody.textContent = bodyInput.value || 'Add a concise customer-facing update.';
    });
    workspace.querySelectorAll('.severity-option').forEach((button) => {
      button.addEventListener('click', () => {
        workspace
          .querySelectorAll('.severity-option')
          .forEach((item) => item.classList.remove('is-selected'));
        button.classList.add('is-selected');
        const [label, color, background] = palette[button.dataset.severity];
        const severity = workspace.querySelector('#alertSeverity');
        workspace.querySelector('#alertRail').style.background = color;
        severity.textContent = label;
        severity.style.color = color;
        severity.style.background = background;
      });
    });
    workspace.querySelectorAll('.delivery-chip').forEach((button) => {
      button.addEventListener('click', () => button.classList.toggle('is-selected'));
    });
  }

  if (activeScreen === 'status') {
    workspace.querySelector('#refreshStatus').addEventListener('click', (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Refreshing…';
      statusMessage.textContent = 'Refreshing external provider status';
      setTimeout(() => {
        button.disabled = false;
        button.textContent = 'Refresh';
        statusMessage.textContent = 'Provider status refreshed just now';
        showToast('Provider status refreshed');
      }, 850);
    });
  }

  if (activeScreen === 'notes') {
    workspace.querySelectorAll('.note-card').forEach((card) => {
      const select = () => {
        workspace
          .querySelectorAll('.note-card')
          .forEach((item) => item.classList.remove('is-selected'));
        card.classList.add('is-selected');
        const note = notes.find((item) => item.id === Number(card.dataset.noteId));
        workspace.querySelector('#noteTitle').value = note.title;
        workspace.querySelector('#noteBody').value = note.body;
      };
      card.addEventListener('click', select);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') select();
      });
    });
  }
}

function renderScreen(name, { updateHash = true } = {}) {
  const next = screens[name] ? name : 'compose';
  activeScreen = next;
  workspace.innerHTML = screens[next]();
  navItems.forEach((item) => {
    const isActive = item.dataset.screen === next;
    item.classList.toggle('is-active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  bindScreenInteractions();
  workspace.scrollTop = 0;
  if (updateHash) history.replaceState(null, '', `#${next}`);
  statusMessage.textContent = `${next[0].toUpperCase()}${next.slice(1)} workspace ready`;
}

function openCommandPalette() {
  commandOverlay.hidden = false;
  requestAnimationFrame(() => commandInput.focus());
}

function closeCommandPalette() {
  commandOverlay.hidden = true;
  commandInput.value = '';
}

function openSettings() {
  settingsBackdrop.hidden = false;
  settingsDrawer.classList.add('is-open');
  settingsDrawer.setAttribute('aria-hidden', 'false');
  settingsDrawer.querySelector('#settingsClose').focus();
}

function closeSettings() {
  settingsDrawer.classList.remove('is-open');
  settingsDrawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    settingsBackdrop.hidden = true;
  }, 220);
}

navItems.forEach((item) => item.addEventListener('click', () => renderScreen(item.dataset.screen)));
commandTrigger.addEventListener('click', openCommandPalette);
commandOverlay.addEventListener('click', (event) => {
  if (event.target === commandOverlay) closeCommandPalette();
});
commandOverlay.querySelectorAll('[data-command-screen]').forEach((button) => {
  button.addEventListener('click', () => {
    renderScreen(button.dataset.commandScreen);
    closeCommandPalette();
  });
});

commandInput.addEventListener('input', () => {
  const query = commandInput.value.trim().toLowerCase();
  commandOverlay.querySelectorAll('[data-command-screen]').forEach((button) => {
    button.hidden = Boolean(query) && !button.textContent.toLowerCase().includes(query);
  });
});

settingsButton.addEventListener('click', openSettings);
settingsBackdrop.addEventListener('click', closeSettings);
document.querySelector('#settingsClose').addEventListener('click', closeSettings);
document.querySelector('#settingsDone').addEventListener('click', closeSettings);
settingsDrawer
  .querySelectorAll('[data-toast]')
  .forEach((button) => button.addEventListener('click', () => showToast(button.dataset.toast)));
settingsDrawer.querySelector('.switch').addEventListener('click', (event) => {
  const button = event.currentTarget;
  button.classList.toggle('is-on');
  button.setAttribute('aria-checked', button.classList.contains('is-on'));
});
settingsDrawer.querySelectorAll('.swatch').forEach((swatch) => {
  swatch.addEventListener('click', () => {
    settingsDrawer
      .querySelectorAll('.swatch')
      .forEach((item) => item.classList.remove('is-selected'));
    swatch.classList.add('is-selected');
    document.documentElement.style.setProperty('--accent', swatch.dataset.accent);
    showToast('Accent updated');
  });
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (commandOverlay.hidden) openCommandPalette();
    else closeCommandPalette();
  }
  if (event.key === 'Escape') {
    if (!commandOverlay.hidden) closeCommandPalette();
    if (settingsDrawer.classList.contains('is-open')) closeSettings();
  }
  if (
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
  ) {
    const shortcuts = {
      1: 'compose',
      2: 'alerts',
      3: 'oncall',
      4: 'status',
      5: 'people',
      6: 'servers',
      7: 'notes',
    };
    if (shortcuts[event.key]) renderScreen(shortcuts[event.key]);
  }
});

function updateClock() {
  document.querySelector('#centralTime').textContent = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

updateClock();
setInterval(updateClock, 1000);
setSegmentedHandlers(settingsDrawer);
renderScreen(location.hash.slice(1) || 'compose', { updateHash: false });
