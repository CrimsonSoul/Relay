#!/usr/bin/env node
// Seed PocketBase with dummy data for visual testing

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSuperuserPassword } from './seedConfig.mjs';
import { seedKnowledgeDocuments } from './seedKnowledge.mjs';

const PB = process.env.RELAY_SEED_PB_URL ?? 'http://localhost:8090';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const seedSuperuserEmail = 'relay-seed@relay.local';
const seedSuperuserPassword = `relay-seed-${randomUUID()}-Passphrase`;
const dynatraceOnly = process.argv.includes('--dynatrace-only');
const clearDynatraceOnly = process.argv.includes('--clear-dynatrace');
const DYNATRACE_DEMO_PREFIX = 'RELAY-DEMO-';
let token = '';
let seedSuperuserId = '';
const failedRecords = [];

function resolvePocketBaseBinary() {
  const binaryName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
  const platformBinaryPath = join(
    __dirname,
    '..',
    'resources',
    'pocketbase',
    `${process.platform}-${process.arch}`,
    binaryName,
  );
  const legacyBinaryPath = join(__dirname, '..', 'resources', 'pocketbase', binaryName);
  const binaryPath = existsSync(platformBinaryPath) ? platformBinaryPath : legacyBinaryPath;
  if (!existsSync(binaryPath)) {
    throw new Error(`PocketBase binary not found at ${binaryPath}. Run npm install first.`);
  }
  return binaryPath;
}

function resolvePocketBaseDataDir() {
  if (process.env.RELAY_SEED_PB_DATA_DIR) return process.env.RELAY_SEED_PB_DATA_DIR;
  if (process.platform === 'darwin') {
    return join(
      process.env.HOME ?? '',
      'Library',
      'Application Support',
      'Relay',
      'data',
      'pb_data',
    );
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? '', 'Relay', 'data', 'pb_data');
  }
  return join(process.env.HOME ?? '', '.config', 'Relay', 'data', 'pb_data');
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function ensureSeedSuperuser() {
  execFileSync(
    resolvePocketBaseBinary(),
    [
      'superuser',
      'upsert',
      seedSuperuserEmail,
      seedSuperuserPassword,
      `--dir=${resolvePocketBaseDataDir()}`,
    ],
    { stdio: 'pipe' },
  );
}

async function authWith(identity, password) {
  const res = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    // Throwing (rather than exiting here) lets the top-level finally clean up
    // the temporary seed superuser that ensureSeedSuperuser may have created.
    console.error(JSON.stringify(data, null, 2));
    throw new Error(`Auth failed with status ${res.status}`);
  }
  token = data.token;
  return data;
}

async function auth() {
  const configuredPassword = process.env.RELAY_SEED_SUPERUSER_PASSWORD;
  if (configuredPassword) {
    const identity = process.env.RELAY_SEED_SUPERUSER_IDENTITY ?? 'admin@relay.app';
    const data = await authWith(identity, getSuperuserPassword(process.env));
    if (process.env.RELAY_SEED_CLEANUP_SUPERUSER === '1') {
      seedSuperuserId = data.record?.id ?? '';
    }
    console.log('Authenticated as configured superuser');
    return;
  }

  if (dynatraceOnly || clearDynatraceOnly) {
    throw new Error(
      'Set RELAY_SEED_SUPERUSER_PASSWORD to the Relay server passphrase before seeding Dynatrace demo data.',
    );
  }

  ensureSeedSuperuser();
  const data = await authWith(seedSuperuserEmail, seedSuperuserPassword);
  seedSuperuserId = data.record?.id ?? '';
  console.log('Authenticated as temporary seed superuser');
}

async function cleanupSeedSuperuser() {
  if (!seedSuperuserId || !token) return;
  await fetch(`${PB}/api/collections/_superusers/records/${seedSuperuserId}`, {
    method: 'DELETE',
    headers: { Authorization: token },
  }).catch(() => undefined);
}

async function create(collection, data) {
  const res = await fetch(`${PB}/api/collections/${collection}/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(data),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`  FAIL ${collection}:`, body);
    failedRecords.push(`${collection} (HTTP ${res.status})`);
    return {};
  }
  return JSON.parse(body);
}

async function createRequired(collection, data) {
  const res = await fetch(`${PB}/api/collections/${collection}/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(data),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Could not create ${collection}: ${body}`);
  return JSON.parse(body);
}

async function clearCollection(collection) {
  let removed = 0;
  while (true) {
    const res = await fetch(`${PB}/api/collections/${collection}/records?perPage=500`, {
      headers: { Authorization: token },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Could not list ${collection}: ${JSON.stringify(data)}`);
    }
    if (!data.items?.length) break;
    let deletedThisPass = 0;
    for (const item of data.items) {
      const del = await fetch(`${PB}/api/collections/${collection}/records/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      });
      if (del.ok) deletedThisPass++;
    }
    // Without this guard an undeletable record loops forever on the same page.
    if (deletedThisPass === 0) {
      throw new Error(`Could not delete any of ${data.items.length} records from ${collection}`);
    }
    removed += deletedThisPass;
  }
  console.log(`  Cleared ${removed} records from ${collection}`);
}

async function listCollection(collection) {
  const records = [];
  let page = 1;
  while (true) {
    const url = new URL(`${PB}/api/collections/${collection}/records`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('perPage', '500');
    const res = await fetch(url, { headers: { Authorization: token } });
    const data = await res.json();
    if (!res.ok) throw new Error(`Could not list ${collection}: ${JSON.stringify(data)}`);
    records.push(...(data.items ?? []));
    if (page >= (data.totalPages ?? 1)) break;
    page += 1;
  }
  return records;
}

async function deleteRecord(collection, id) {
  const res = await fetch(`${PB}/api/collections/${collection}/records/${id}`, {
    method: 'DELETE',
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`Could not delete ${collection}/${id}: ${await res.text()}`);
}

async function clearDynatraceDemoData() {
  let removed = 0;
  for (const collection of [
    'dynatrace_problem_notes',
    'dynatrace_problem_states',
    'dynatrace_problems',
    'knowledge_documents',
  ]) {
    const records = await listCollection(collection);
    const demoRecords = records.filter((record) =>
      String(record.problemId ?? '').startsWith(DYNATRACE_DEMO_PREFIX),
    );
    for (const record of demoRecords) await deleteRecord(collection, record.id);
    removed += demoRecords.length;
    console.log(`  Cleared ${demoRecords.length} demo records from ${collection}`);
  }
  return removed;
}

function makeDynatraceProblemData(now = Date.now()) {
  const minutesAgo = (minutes) => now - minutes * 60_000;
  const hoursAgo = (hours) => now - hours * 60 * 60_000;
  const syncedAt = new Date(minutesAgo(1)).toISOString();
  const environmentUrl = 'https://relay-demo.live.dynatrace.com';

  const problems = [
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1001`,
      displayId: 'P-DEMO-1001',
      title: 'Checkout service availability below SLO',
      status: 'OPEN',
      severity: 'AVAILABILITY',
      impactLevel: 'APPLICATION',
      startTime: minutesAgo(18),
      endTime: -1,
      rootCauseName: 'checkout-web',
      affectedEntities: [
        { id: 'APPLICATION-DEMO-1', type: 'APPLICATION', name: 'Checkout Web' },
        { id: 'SERVICE-DEMO-1', type: 'SERVICE', name: 'checkout-api' },
      ],
      impactedEntities: [{ id: 'APPLICATION-DEMO-1', type: 'APPLICATION', name: 'Checkout Web' }],
      managementZones: [{ id: 'ZONE-DEMO-1', name: 'Payments Production' }],
      alertingProfiles: ['Payments Production'],
      environmentUrl,
      syncedAt,
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1002`,
      displayId: 'P-DEMO-1002',
      title: 'Payment API response time degradation',
      workflowTitle: 'NOC · Payment path degraded',
      workflowDescription: 'Escalate when checkout latency remains elevated.',
      workflowTags: ['teams:payments', 'customer-impacting'],
      workflowAffectedEntityTypes: ['SERVICE', 'HOST'],
      status: 'OPEN',
      severity: 'PERFORMANCE',
      impactLevel: 'SERVICES',
      startTime: minutesAgo(47),
      endTime: -1,
      rootCauseName: 'payments-api',
      affectedEntities: [
        { id: 'SERVICE-DEMO-2', type: 'SERVICE', name: 'payments-api' },
        { id: 'HOST-DEMO-7', type: 'HOST', name: 'prod-api-07' },
      ],
      impactedEntities: [
        { id: 'SERVICE-DEMO-3', type: 'SERVICE', name: 'order-submit' },
        { id: 'SERVICE-DEMO-4', type: 'SERVICE', name: 'refunds-api' },
      ],
      managementZones: [{ id: 'ZONE-DEMO-1', name: 'Payments Production' }],
      alertingProfiles: ['Payments Production'],
      environmentUrl,
      syncedAt,
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1003`,
      displayId: 'P-DEMO-1003',
      title: 'Database connection pool saturation',
      status: 'OPEN',
      severity: 'RESOURCE_CONTENTION',
      impactLevel: 'INFRASTRUCTURE',
      startTime: hoursAgo(2.4),
      endTime: -1,
      rootCauseName: 'orders-db-02',
      affectedEntities: [
        { id: 'PROCESS-GROUP-DEMO-2', type: 'PROCESS_GROUP', name: 'orders-postgres' },
        { id: 'HOST-DEMO-9', type: 'HOST', name: 'orders-db-02' },
      ],
      impactedEntities: [{ id: 'SERVICE-DEMO-5', type: 'SERVICE', name: 'orders-api' }],
      managementZones: [{ id: 'ZONE-DEMO-2', name: 'Order Platform' }],
      alertingProfiles: ['Order Platform'],
      environmentUrl,
      syncedAt,
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1004`,
      displayId: 'P-DEMO-1004',
      title: 'Synthetic checkout monitors stopped reporting from three locations',
      status: 'OPEN',
      severity: 'MONITORING_UNAVAILABLE',
      impactLevel: 'ENVIRONMENT',
      startTime: hoursAgo(4.1),
      endTime: -1,
      rootCauseName: '',
      affectedEntities: [
        { id: 'SYNTHETIC-DEMO-1', type: 'SYNTHETIC_TEST', name: 'Global Checkout Journey' },
      ],
      impactedEntities: [],
      managementZones: [],
      alertingProfiles: ['Synthetic Monitoring'],
      environmentUrl,
      syncedAt,
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1005`,
      displayId: 'P-DEMO-1005',
      title: 'TLS certificate expires within 14 days',
      status: 'OPEN',
      severity: 'CUSTOM_ALERT',
      impactLevel: 'INFRASTRUCTURE',
      startTime: hoursAgo(9.5),
      endTime: -1,
      rootCauseName: 'edge-lb-prod',
      affectedEntities: [
        { id: 'HOST-DEMO-11', type: 'HOST', name: 'edge-lb-prod-01' },
        { id: 'HOST-DEMO-12', type: 'HOST', name: 'edge-lb-prod-02' },
      ],
      impactedEntities: [],
      managementZones: [{ id: 'ZONE-DEMO-3', name: 'Network Edge' }],
      alertingProfiles: ['Network Edge'],
      environmentUrl,
      syncedAt,
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1006`,
      displayId: 'P-DEMO-1006',
      title: 'Elevated login failure rate',
      status: 'CLOSED',
      severity: 'ERROR',
      impactLevel: 'SERVICES',
      startTime: hoursAgo(7.2),
      endTime: hoursAgo(5.8),
      rootCauseName: 'identity-gateway',
      affectedEntities: [{ id: 'SERVICE-DEMO-9', type: 'SERVICE', name: 'identity-gateway' }],
      impactedEntities: [
        { id: 'APPLICATION-DEMO-6', type: 'APPLICATION', name: 'Customer Portal' },
      ],
      managementZones: [{ id: 'ZONE-DEMO-4', name: 'Customer Identity' }],
      alertingProfiles: ['Customer Identity'],
      environmentUrl,
      syncedAt,
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1007`,
      displayId: 'P-DEMO-1007',
      title: 'Deployment health event completed successfully',
      status: 'CLOSED',
      severity: 'INFO',
      impactLevel: 'ENVIRONMENT',
      startTime: hoursAgo(14),
      endTime: hoursAgo(13.5),
      rootCauseName: 'catalog-api',
      affectedEntities: [{ id: 'SERVICE-DEMO-12', type: 'SERVICE', name: 'catalog-api' }],
      impactedEntities: [],
      managementZones: [{ id: 'ZONE-DEMO-5', name: 'Catalog Production' }],
      alertingProfiles: ['Catalog Production'],
      environmentUrl,
      syncedAt,
    },
  ];

  const states = [
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1003`,
      addressed: true,
      addressedAt: new Date(minutesAgo(52)).toISOString(),
      addressedBy: 'noc-demo-west-03',
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1006`,
      addressed: true,
      addressedAt: new Date(minutesAgo(370)).toISOString(),
      addressedBy: 'noc-demo-east-01',
    },
  ];

  const notes = [
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1002`,
      author: 'noc-demo-central-02',
      note: 'Confirmed impact in the checkout path. Payments team is reviewing the last deployment.',
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1002`,
      author: 'noc-demo-central-02',
      note: 'Error rate is stable; latency remains above baseline. Continue monitoring before escalation.',
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1003`,
      author: 'noc-demo-west-03',
      note: 'Connection pool was raised from 180 to 220 while the database team investigates long-running sessions.',
    },
    {
      problemId: `${DYNATRACE_DEMO_PREFIX}1006`,
      author: 'noc-demo-east-01',
      note: 'Identity team rolled back the gateway policy change. Dynatrace confirmed recovery.',
    },
  ];

  return { problems, states, notes };
}

async function seedDynatraceProblems() {
  const { problems, states, notes } = makeDynatraceProblemData();
  console.log('Seeding Dynatrace Problems demo data...');
  for (const problem of problems) await createRequired('dynatrace_problems', problem);
  for (const state of states) await createRequired('dynatrace_problem_states', state);
  for (const note of notes) await createRequired('dynatrace_problem_notes', note);
  console.log(
    `  Created ${problems.length} problems, ${states.length} local state, and ${notes.length} notes`,
  );
}

async function seed() {
  await auth();

  if (clearDynatraceOnly) {
    const removed = await clearDynatraceDemoData();
    console.log(`\n✅ Removed ${removed} Dynatrace demo records.`);
    return;
  }

  if (dynatraceOnly) {
    await clearDynatraceDemoData();
    await seedDynatraceProblems();
    console.log('\n✅ Dynatrace Problems demo seed complete!');
    return;
  }

  // Clear all app-facing collections so the seed is repeatable.
  for (const col of [
    'contacts',
    'servers',
    'oncall',
    'bridge_groups',
    'bridge_history',
    'alert_history',
    'notes',
    'oncall_dismissals',
    'conflict_log',
    'oncall_board_settings',
    'dynatrace_problem_notes',
    'dynatrace_problem_states',
    'dynatrace_problems',
  ]) {
    console.log(`Clearing ${col}...`);
    await clearCollection(col);
  }

  console.log('Seeding contacts...');
  const contacts = [
    {
      name: 'Sarah Chen',
      email: 'sarah.chen@corp.com',
      phone: '+1-555-0101',
      title: 'Sr. Site Reliability Engineer',
    },
    {
      name: 'Marcus Johnson',
      email: 'marcus.j@corp.com',
      phone: '+1-555-0102',
      title: 'Platform Lead',
    },
    {
      name: 'Emily Rodriguez',
      email: 'emily.r@corp.com',
      phone: '+1-555-0103',
      title: 'Security Analyst',
    },
    {
      name: 'David Kim',
      email: 'david.kim@corp.com',
      phone: '+1-555-0104',
      title: 'Network Engineer',
    },
    {
      name: 'Rachel Thompson',
      email: 'rachel.t@corp.com',
      phone: '+1-555-0105',
      title: 'DevOps Manager',
    },
    {
      name: 'James Wilson',
      email: 'james.w@corp.com',
      phone: '+1-555-0106',
      title: 'Infrastructure Architect',
    },
    {
      name: 'Priya Patel',
      email: 'priya.p@corp.com',
      phone: '+1-555-0107',
      title: 'Database Administrator',
    },
    { name: 'Alex Novak', email: 'alex.n@corp.com', phone: '+1-555-0108', title: 'Cloud Engineer' },
    {
      name: 'Lisa Chang',
      email: 'lisa.c@corp.com',
      phone: '+1-555-0109',
      title: 'Incident Commander',
    },
    {
      name: 'Omar Hassan',
      email: 'omar.h@corp.com',
      phone: '+1-555-0110',
      title: 'Systems Administrator',
    },
    {
      name: 'Natalie Brooks',
      email: 'natalie.b@corp.com',
      phone: '+1-555-0111',
      title: 'SOC Analyst',
    },
    {
      name: 'Tyler Grant',
      email: 'tyler.g@corp.com',
      phone: '+1-555-0112',
      title: 'Release Manager',
    },
    {
      name: 'Mei Lin Wang',
      email: 'mei.w@corp.com',
      phone: '+1-555-0113',
      title: 'Software Engineer II',
    },
    {
      name: 'Carlos Reyes',
      email: 'carlos.r@corp.com',
      phone: '+1-555-0114',
      title: 'Monitoring Lead',
    },
    {
      name: 'Jessica Palmer',
      email: 'jessica.p@corp.com',
      phone: '+1-555-0115',
      title: 'Change Manager',
    },
    {
      name: 'Ryan Mitchell',
      email: 'ryan.m@corp.com',
      phone: '+1-555-0116',
      title: 'VP Engineering',
    },
    {
      name: 'Samantha Lee',
      email: 'sam.lee@corp.com',
      phone: '+1-555-0117',
      title: 'Product Manager',
    },
    { name: "Kevin O'Brien", email: 'kevin.ob@corp.com', phone: '+1-555-0118', title: 'QA Lead' },
    {
      name: 'Diana Foster',
      email: 'diana.f@corp.com',
      phone: '+1-555-0119',
      title: 'Technical Writer',
    },
    {
      name: 'Andrew Park',
      email: 'andrew.p@corp.com',
      phone: '+1-555-0120',
      title: 'Data Engineer',
    },
    {
      name: 'Michelle Torres',
      email: 'michelle.t@corp.com',
      phone: '+1-555-0121',
      title: 'Security Engineer',
    },
    {
      name: 'Brian Schultz',
      email: 'brian.s@corp.com',
      phone: '+1-555-0122',
      title: 'Network Architect',
    },
    { name: 'Hannah Kim', email: 'hannah.k@corp.com', phone: '+1-555-0123', title: 'SRE Manager' },
    {
      name: 'Dmitri Volkov',
      email: 'dmitri.v@corp.com',
      phone: '+1-555-0124',
      title: 'Backend Engineer',
    },
    {
      name: 'Sofia Ramirez',
      email: 'sofia.r@corp.com',
      phone: '+1-555-0125',
      title: 'Frontend Engineer',
    },
  ];
  for (const c of contacts) await create('contacts', c);

  console.log('Seeding bridge_groups...');
  const groups = [
    {
      name: 'OPS — Core SRE',
      contacts: [
        'sarah.chen@corp.com',
        'marcus.j@corp.com',
        'lisa.c@corp.com',
        'omar.h@corp.com',
        'hannah.k@corp.com',
      ],
    },
    {
      name: 'Field — Network',
      contacts: ['david.kim@corp.com', 'brian.s@corp.com', 'alex.n@corp.com'],
    },
    {
      name: 'HQ — Security',
      contacts: ['emily.r@corp.com', 'natalie.b@corp.com', 'michelle.t@corp.com'],
    },
    {
      name: 'Platform — DevOps',
      contacts: ['rachel.t@corp.com', 'james.w@corp.com', 'tyler.g@corp.com', 'carlos.r@corp.com'],
    },
    {
      name: 'Leadership',
      contacts: ['ryan.m@corp.com', 'sam.lee@corp.com', 'rachel.t@corp.com', 'hannah.k@corp.com'],
    },
    {
      name: 'Data — Engineering',
      contacts: ['priya.p@corp.com', 'andrew.p@corp.com', 'dmitri.v@corp.com'],
    },
  ];
  for (const g of groups) await create('bridge_groups', g);

  console.log('Seeding oncall...');
  const oncall = [
    {
      team: 'SRE — Primary',
      teamId: 'sre-primary',
      role: 'Primary On-Call',
      name: 'Sarah Chen',
      contact: '+1-555-0101',
      timeWindow: '06:00–18:00 ET',
      sortOrder: 1,
    },
    {
      team: 'SRE — Primary',
      teamId: 'sre-primary',
      role: 'Secondary On-Call',
      name: 'Omar Hassan',
      contact: '+1-555-0110',
      timeWindow: '06:00–18:00 ET',
      sortOrder: 2,
    },
    {
      team: 'SRE — Primary',
      teamId: 'sre-primary',
      role: 'Incident Commander',
      name: 'Lisa Chang',
      contact: '+1-555-0109',
      timeWindow: '24/7',
      sortOrder: 3,
    },
    {
      team: 'Platform',
      teamId: 'platform',
      role: 'Primary On-Call',
      name: 'Marcus Johnson',
      contact: '+1-555-0102',
      timeWindow: '08:00–20:00 ET',
      sortOrder: 1,
    },
    {
      team: 'Platform',
      teamId: 'platform',
      role: 'Escalation',
      name: 'Rachel Thompson',
      contact: '+1-555-0105',
      timeWindow: '24/7',
      sortOrder: 2,
    },
    {
      team: 'Platform',
      teamId: 'platform',
      role: 'Build Engineer',
      name: 'Tyler Grant',
      contact: '+1-555-0112',
      timeWindow: '09:00–17:00 ET',
      sortOrder: 3,
    },
    {
      team: 'Security',
      teamId: 'security',
      role: 'SOC Analyst',
      name: 'Emily Rodriguez',
      contact: '+1-555-0103',
      timeWindow: '00:00–12:00 ET',
      sortOrder: 1,
    },
    {
      team: 'Security',
      teamId: 'security',
      role: 'SOC Analyst',
      name: 'Natalie Brooks',
      contact: '+1-555-0111',
      timeWindow: '12:00–00:00 ET',
      sortOrder: 2,
    },
    {
      team: 'Security',
      teamId: 'security',
      role: 'Security Lead',
      name: 'Michelle Torres',
      contact: '+1-555-0121',
      timeWindow: '09:00–17:00 ET',
      sortOrder: 3,
    },
    {
      team: 'Data Engineering',
      teamId: 'data-engineering',
      role: 'Primary On-Call',
      name: 'Priya Patel',
      contact: '+1-555-0107',
      timeWindow: '06:00–18:00 ET',
      sortOrder: 1,
    },
    {
      team: 'Data Engineering',
      teamId: 'data-engineering',
      role: 'Pipeline Support',
      name: 'Andrew Park',
      contact: '+1-555-0120',
      timeWindow: '09:00–17:00 ET',
      sortOrder: 2,
    },
    {
      team: 'Network',
      teamId: 'network',
      role: 'NOC Primary',
      name: 'David Kim',
      contact: '+1-555-0104',
      timeWindow: '06:00–18:00 ET',
      sortOrder: 1,
    },
    {
      team: 'Network',
      teamId: 'network',
      role: 'NOC Secondary',
      name: 'Brian Schultz',
      contact: '+1-555-0122',
      timeWindow: '18:00–06:00 ET',
      sortOrder: 2,
    },
  ];
  for (const o of oncall) await create('oncall', o);

  console.log('Seeding oncall_board_settings...');
  await create('oncall_board_settings', {
    key: 'primary',
    teamOrder: ['sre-primary', 'platform', 'security', 'data-engineering', 'network'],
    locked: false,
  });

  console.log('Seeding servers...');
  const servers = [
    {
      name: 'prod-api-01',
      businessArea: 'Engineering',
      lob: 'Core Platform',
      comment: 'Primary API gateway',
      owner: 'Marcus Johnson',
      contact: 'marcus.j@corp.com',
      os: 'Ubuntu 22.04',
    },
    {
      name: 'prod-api-02',
      businessArea: 'Engineering',
      lob: 'Core Platform',
      comment: 'Secondary API gateway',
      owner: 'Marcus Johnson',
      contact: 'marcus.j@corp.com',
      os: 'Ubuntu 22.04',
    },
    {
      name: 'prod-db-primary',
      businessArea: 'Engineering',
      lob: 'Data',
      comment: 'PostgreSQL primary',
      owner: 'Priya Patel',
      contact: 'priya.p@corp.com',
      os: 'Ubuntu 22.04',
    },
    {
      name: 'prod-db-replica-01',
      businessArea: 'Engineering',
      lob: 'Data',
      comment: 'PostgreSQL read replica',
      owner: 'Priya Patel',
      contact: 'priya.p@corp.com',
      os: 'Ubuntu 22.04',
    },
    {
      name: 'prod-cache-01',
      businessArea: 'Engineering',
      lob: 'Core Platform',
      comment: 'Redis cluster node',
      owner: 'James Wilson',
      contact: 'james.w@corp.com',
      os: 'Amazon Linux 2',
    },
    {
      name: 'prod-worker-01',
      businessArea: 'Engineering',
      lob: 'Processing',
      comment: 'Background job processor',
      owner: 'Dmitri Volkov',
      contact: 'dmitri.v@corp.com',
      os: 'Ubuntu 22.04',
    },
    {
      name: 'prod-worker-02',
      businessArea: 'Engineering',
      lob: 'Processing',
      comment: 'Background job processor',
      owner: 'Dmitri Volkov',
      contact: 'dmitri.v@corp.com',
      os: 'Ubuntu 22.04',
    },
    {
      name: 'staging-api-01',
      businessArea: 'Engineering',
      lob: 'Core Platform',
      comment: 'Staging environment',
      owner: 'Tyler Grant',
      contact: 'tyler.g@corp.com',
      os: 'Ubuntu 22.04',
    },
    {
      name: 'monitor-01',
      businessArea: 'Operations',
      lob: 'Monitoring',
      comment: 'Prometheus + Grafana',
      owner: 'Carlos Reyes',
      contact: 'carlos.r@corp.com',
      os: 'Debian 12',
    },
    {
      name: 'monitor-02',
      businessArea: 'Operations',
      lob: 'Monitoring',
      comment: 'AlertManager + PagerDuty relay',
      owner: 'Carlos Reyes',
      contact: 'carlos.r@corp.com',
      os: 'Debian 12',
    },
    {
      name: 'vpn-gateway-01',
      businessArea: 'Security',
      lob: 'Network',
      comment: 'Primary VPN concentrator',
      owner: 'David Kim',
      contact: 'david.kim@corp.com',
      os: 'pfSense 2.7',
    },
    {
      name: 'siem-collector-01',
      businessArea: 'Security',
      lob: 'Security Ops',
      comment: 'Log collector and SIEM ingest',
      owner: 'Emily Rodriguez',
      contact: 'emily.r@corp.com',
      os: 'CentOS Stream 9',
    },
    {
      name: 'build-runner-01',
      businessArea: 'Engineering',
      lob: 'CI/CD',
      comment: 'GitHub Actions self-hosted runner',
      owner: 'Tyler Grant',
      contact: 'tyler.g@corp.com',
      os: 'Ubuntu 22.04',
    },
    {
      name: 'dns-primary',
      businessArea: 'Operations',
      lob: 'Network',
      comment: 'Internal DNS resolver',
      owner: 'Brian Schultz',
      contact: 'brian.s@corp.com',
      os: 'Ubuntu 22.04',
    },
    {
      name: 'nfs-share-01',
      businessArea: 'Engineering',
      lob: 'Storage',
      comment: 'Shared file storage',
      owner: 'Omar Hassan',
      contact: 'omar.h@corp.com',
      os: 'TrueNAS 13',
    },
  ];
  for (const s of servers) await create('servers', s);

  console.log('Seeding attached notes...');
  const attachedNotes = [
    {
      entityType: 'contact',
      entityKey: 'sarah.chen@corp.com',
      note: 'Primary escalation contact for API incidents. Prefers SMS first during business hours and phone for overnight pages.',
      tags: ['sre', 'escalation', 'api'],
    },
    {
      entityType: 'contact',
      entityKey: 'emily.r@corp.com',
      note: 'Owns security incident intake and evidence preservation. Include SOC bridge when this contact is selected.',
      tags: ['security', 'soc', 'incident'],
    },
    {
      entityType: 'contact',
      entityKey: 'priya.p@corp.com',
      note: 'Database owner for production PostgreSQL. Has final approval on failover and replica promotion.',
      tags: ['database', 'postgres', 'failover'],
    },
    {
      entityType: 'server',
      entityKey: 'prod-api-01',
      note: 'Primary API gateway. Watch p99 latency, upstream connection saturation, and certificate expiry before planned rotations.',
      tags: ['api', 'production', 'gateway'],
    },
    {
      entityType: 'server',
      entityKey: 'prod-db-primary',
      note: 'Critical PostgreSQL primary. Run backup verification before maintenance and notify Data Engineering for failover drills.',
      tags: ['database', 'critical', 'backup'],
    },
    {
      entityType: 'server',
      entityKey: 'monitor-02',
      note: 'AlertManager relay node. If notifications stop, confirm PagerDuty routing keys and outbound firewall rules first.',
      tags: ['monitoring', 'pagerduty', 'alerts'],
    },
  ];
  for (const n of attachedNotes) await create('notes', n);

  console.log('Seeding alert_history...');
  const alerts = [
    {
      severity: 'ISSUE',
      subject: 'ISSUE — Database connection pool exhaustion on prod-db-primary',
      bodyHtml:
        '<p>Connection pool at 98% capacity. Active connections: 196/200. Oldest idle: 45 minutes.</p><p>Affected services: prod-api-01, prod-api-02, prod-worker-01</p>',
      sender: 'noc@corp.com',
      recipient: 'ops-all@corp.com',
      pinned: false,
      label: '',
    },
    {
      severity: 'MAINTENANCE',
      subject: 'MAINTENANCE — Scheduled certificate rotation on load balancers',
      bodyHtml:
        '<p>Rotating TLS certificates on all production load balancers.</p><p>Window: Saturday 2:00 AM–3:00 AM ET</p><p>Expected impact: Brief connection resets during rotation.</p>',
      sender: 'change-mgmt@corp.com',
      recipient: 'ops-all@corp.com',
      pinned: false,
      label: '',
    },
    {
      severity: 'ISSUE',
      subject: 'ISSUE — Elevated 5xx error rate on API gateway',
      bodyHtml:
        '<p>5xx rate increased from 0.1% to 3.2% in the last 15 minutes.</p><p>Top affected endpoints: /api/v2/users, /api/v2/orders</p><p>Correlates with deployment rel-2.4.7 at 14:32 ET.</p>',
      sender: 'monitoring@corp.com',
      recipient: 'sre-primary@corp.com',
      pinned: true,
      label: 'active',
    },
    {
      severity: 'RESOLVED',
      subject: 'RESOLVED — DNS resolution failures in us-east-1',
      bodyHtml:
        '<p>DNS resolution failures have been resolved.</p><p>Root cause: Upstream provider route leak affecting recursive resolvers.</p><p>Duration: 23 minutes. No data loss.</p>',
      sender: 'noc@corp.com',
      recipient: 'ops-all@corp.com',
      pinned: false,
      label: '',
    },
    {
      severity: 'INFO',
      subject: 'INFO — New monitoring dashboards deployed',
      bodyHtml:
        '<p>Updated Grafana dashboards for Q2 metrics:</p><ul><li>API latency P99 by endpoint</li><li>Worker queue depth and processing time</li><li>Cache hit ratio trends</li></ul>',
      sender: 'platform@corp.com',
      recipient: 'engineering-all@corp.com',
      pinned: false,
      label: '',
    },
    {
      severity: 'ISSUE',
      subject: 'ISSUE — Worker queue backlog exceeding threshold',
      bodyHtml:
        '<p>Background job queue depth: 15,420 (threshold: 5,000)</p><p>Oldest job: 2h 14m ago</p><p>Affected queues: email_notifications, report_generation</p>',
      sender: 'monitoring@corp.com',
      recipient: 'platform-oncall@corp.com',
      pinned: false,
      label: '',
    },
  ];
  for (const a of alerts) await create('alert_history', a);

  console.log('Seeding bridge_history...');
  const history = [
    {
      note: 'Emergency bridge — DB failover coordination',
      groups: ['OPS — Core SRE', 'Data — Engineering'],
      contacts: [
        'sarah.chen@corp.com',
        'priya.p@corp.com',
        'omar.h@corp.com',
        'andrew.p@corp.com',
        'lisa.c@corp.com',
      ],
      recipientCount: 5,
    },
    {
      note: 'Planned maintenance window coordination',
      groups: ['Platform — DevOps', 'Network'],
      contacts: [
        'rachel.t@corp.com',
        'james.w@corp.com',
        'tyler.g@corp.com',
        'david.kim@corp.com',
        'brian.s@corp.com',
        'carlos.r@corp.com',
      ],
      recipientCount: 6,
    },
    {
      note: 'Security incident response',
      groups: ['HQ — Security', 'Leadership'],
      contacts: [
        'emily.r@corp.com',
        'natalie.b@corp.com',
        'michelle.t@corp.com',
        'ryan.m@corp.com',
      ],
      recipientCount: 4,
    },
  ];
  for (const h of history) await create('bridge_history', h);

  console.log('Seeding oncall_dismissals...');
  await create('oncall_dismissals', {
    alertType: 'general',
    dateKey: todayDateKey(),
  });

  console.log('Seeding conflict_log...');
  await create('conflict_log', {
    collection: 'contacts',
    recordId: 'dummy-conflict-sarah-chen',
    overwrittenData: {
      name: 'Sarah Chen',
      email: 'sarah.chen@corp.com',
      title: 'Site Reliability Engineer',
    },
    overwrittenBy: 'seed-script',
  });

  console.log('Seeding Knowledge Base documents...');
  const knowledgeDocuments = await seedKnowledgeDocuments({ baseUrl: PB, token });
  console.log(`  Created ${knowledgeDocuments.length} protected PDF documents`);

  await seedDynatraceProblems();

  // create() reports per-record failures without aborting; a partial seed must
  // still exit non-zero instead of printing a success banner.
  if (failedRecords.length > 0) {
    throw new Error(`${failedRecords.length} records failed: ${failedRecords.join(', ')}`);
  }

  console.log('\n✅ Seed complete!');
}

try {
  await seed();
} catch (err) {
  console.error('Seed failed:', err instanceof Error ? err.message : 'Unknown error');
  // Exiting immediately here would skip the finally block below and strand the
  // temporary seed superuser in PocketBase; setting exitCode lets cleanup run.
  process.exitCode = 1;
} finally {
  await cleanupSeedSuperuser();
}
