#!/usr/bin/env node
// Seed PocketBase with dummy data for visual testing

const PB = 'http://localhost:8090';
let token = '';

async function auth() {
  const res = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: 'admin@relay.app', password: 'testtest' }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Auth failed:', data);
    process.exit(1);
  }
  token = data.token;
  console.log('Authenticated as superuser');
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
    return {};
  }
  return JSON.parse(body);
}

async function clearCollection(collection) {
  const res = await fetch(`${PB}/api/collections/${collection}/records?perPage=500`, {
    headers: { Authorization: token },
  });
  const data = await res.json();
  if (data.items) {
    for (const item of data.items) {
      await fetch(`${PB}/api/collections/${collection}/records/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: token },
      });
    }
    console.log(`  Cleared ${data.items.length} records from ${collection}`);
  }
}

async function seed() {
  await auth();

  // Clear all collections to re-seed with proper timestamps
  for (const col of ['oncall', 'alert_history', 'bridge_history', 'standalone_notes']) {
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
      contacts: JSON.stringify([
        'sarah.chen@corp.com',
        'marcus.j@corp.com',
        'lisa.c@corp.com',
        'omar.h@corp.com',
        'hannah.k@corp.com',
      ]),
    },
    {
      name: 'Field — Network',
      contacts: JSON.stringify(['david.kim@corp.com', 'brian.s@corp.com', 'alex.n@corp.com']),
    },
    {
      name: 'HQ — Security',
      contacts: JSON.stringify(['emily.r@corp.com', 'natalie.b@corp.com', 'michelle.t@corp.com']),
    },
    {
      name: 'Platform — DevOps',
      contacts: JSON.stringify([
        'rachel.t@corp.com',
        'james.w@corp.com',
        'tyler.g@corp.com',
        'carlos.r@corp.com',
      ]),
    },
    {
      name: 'Leadership',
      contacts: JSON.stringify([
        'ryan.m@corp.com',
        'sam.lee@corp.com',
        'rachel.t@corp.com',
        'hannah.k@corp.com',
      ]),
    },
    {
      name: 'Data — Engineering',
      contacts: JSON.stringify(['priya.p@corp.com', 'andrew.p@corp.com', 'dmitri.v@corp.com']),
    },
  ];
  for (const g of groups) await create('bridge_groups', g);

  console.log('Seeding oncall...');
  const oncall = [
    {
      team: 'SRE — Primary',
      role: 'Primary On-Call',
      name: 'Sarah Chen',
      contact: '+1-555-0101',
      timeWindow: '06:00–18:00 ET',
      sortOrder: 1,
    },
    {
      team: 'SRE — Primary',
      role: 'Secondary On-Call',
      name: 'Omar Hassan',
      contact: '+1-555-0110',
      timeWindow: '06:00–18:00 ET',
      sortOrder: 2,
    },
    {
      team: 'SRE — Primary',
      role: 'Incident Commander',
      name: 'Lisa Chang',
      contact: '+1-555-0109',
      timeWindow: '24/7',
      sortOrder: 3,
    },
    {
      team: 'Platform',
      role: 'Primary On-Call',
      name: 'Marcus Johnson',
      contact: '+1-555-0102',
      timeWindow: '08:00–20:00 ET',
      sortOrder: 1,
    },
    {
      team: 'Platform',
      role: 'Escalation',
      name: 'Rachel Thompson',
      contact: '+1-555-0105',
      timeWindow: '24/7',
      sortOrder: 2,
    },
    {
      team: 'Platform',
      role: 'Build Engineer',
      name: 'Tyler Grant',
      contact: '+1-555-0112',
      timeWindow: '09:00–17:00 ET',
      sortOrder: 3,
    },
    {
      team: 'Security',
      role: 'SOC Analyst',
      name: 'Emily Rodriguez',
      contact: '+1-555-0103',
      timeWindow: '00:00–12:00 ET',
      sortOrder: 1,
    },
    {
      team: 'Security',
      role: 'SOC Analyst',
      name: 'Natalie Brooks',
      contact: '+1-555-0111',
      timeWindow: '12:00–00:00 ET',
      sortOrder: 2,
    },
    {
      team: 'Security',
      role: 'Security Lead',
      name: 'Michelle Torres',
      contact: '+1-555-0121',
      timeWindow: '09:00–17:00 ET',
      sortOrder: 3,
    },
    {
      team: 'Data Engineering',
      role: 'Primary On-Call',
      name: 'Priya Patel',
      contact: '+1-555-0107',
      timeWindow: '06:00–18:00 ET',
      sortOrder: 1,
    },
    {
      team: 'Data Engineering',
      role: 'Pipeline Support',
      name: 'Andrew Park',
      contact: '+1-555-0120',
      timeWindow: '09:00–17:00 ET',
      sortOrder: 2,
    },
    {
      team: 'Network',
      role: 'NOC Primary',
      name: 'David Kim',
      contact: '+1-555-0104',
      timeWindow: '06:00–18:00 ET',
      sortOrder: 1,
    },
    {
      team: 'Network',
      role: 'NOC Secondary',
      name: 'Brian Schultz',
      contact: '+1-555-0122',
      timeWindow: '18:00–06:00 ET',
      sortOrder: 2,
    },
  ];
  for (const o of oncall) await create('oncall', o);

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

  console.log('Seeding standalone_notes...');
  const notes = [
    {
      title: 'Runbook — API Failover',
      content:
        '1. Verify health check failures on prod-api-01\n2. Confirm prod-api-02 is healthy\n3. Update Route53 to point to secondary\n4. Notify #incidents channel\n5. Begin root cause analysis on primary',
      color: 'red',
      tags: JSON.stringify(['runbook', 'api', 'failover']),
      sortOrder: 1,
    },
    {
      title: 'Q2 Capacity Planning',
      content:
        'Current utilization:\n- API: 68% peak\n- DB: 45% peak (read replicas at 30%)\n- Workers: 82% peak — need 2 more\n- Cache: 55% memory usage\n\nAction items:\n- Scale worker pool by 2 nodes\n- Evaluate DB vertical scale vs horizontal',
      color: 'blue',
      tags: JSON.stringify(['planning', 'capacity', 'q2']),
      sortOrder: 2,
    },
    {
      title: 'Incident Postmortem — 3/15 Outage',
      content:
        'Duration: 47 minutes\nImpact: 100% API failures\nRoot cause: Certificate expiration on load balancer\nContributing: No monitoring on cert expiry dates\n\nAction items:\n- Add cert expiry monitoring (Carlos)\n- Document renewal process (Diana)\n- Set up auto-renewal where possible (Alex)',
      color: 'amber',
      tags: JSON.stringify(['postmortem', 'incident', 'certs']),
      sortOrder: 3,
    },
    {
      title: 'New Hire Onboarding Checklist',
      content:
        '- [ ] VPN access setup\n- [ ] GitHub org invite\n- [ ] PagerDuty account\n- [ ] Slack channels (#ops, #incidents, #platform)\n- [ ] AWS IAM role assignment\n- [ ] Runbook review session\n- [ ] Shadow on-call shift',
      color: 'green',
      tags: JSON.stringify(['onboarding', 'hr', 'checklist']),
      sortOrder: 4,
    },
    {
      title: 'Vendor Contacts',
      content:
        'AWS TAM: Jennifer Liu — jliu@aws.amazon.com — (206) 555-0190\nCloudflare SE: Mike Torres — mtorres@cloudflare.com\nPagerDuty CSM: Alisha Grant — agrant@pagerduty.com\nDatadog AE: Chris Nguyen — cnguyen@datadoghq.com',
      color: 'purple',
      tags: JSON.stringify(['vendors', 'contacts']),
      sortOrder: 5,
    },
    {
      title: 'Weekend Maintenance Window',
      content:
        'Saturday 2:00 AM–6:00 AM ET\n\n1. PostgreSQL minor version upgrade (prod-db-primary)\n2. Kernel patches on all Ubuntu hosts\n3. Redis cluster rebalance\n4. Rotate TLS certificates on LB\n\nRollback plan: snapshot before each step, 15-min checkpoint',
      color: 'slate',
      tags: JSON.stringify(['maintenance', 'weekend', 'planned']),
      sortOrder: 6,
    },
  ];
  for (const n of notes) await create('standalone_notes', n);

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
      groups: JSON.stringify(['OPS — Core SRE', 'Data — Engineering']),
      contacts: JSON.stringify([
        'sarah.chen@corp.com',
        'priya.p@corp.com',
        'omar.h@corp.com',
        'andrew.p@corp.com',
        'lisa.c@corp.com',
      ]),
      recipientCount: 5,
    },
    {
      note: 'Planned maintenance window coordination',
      groups: JSON.stringify(['Platform — DevOps', 'Network']),
      contacts: JSON.stringify([
        'rachel.t@corp.com',
        'james.w@corp.com',
        'tyler.g@corp.com',
        'david.kim@corp.com',
        'brian.s@corp.com',
        'carlos.r@corp.com',
      ]),
      recipientCount: 6,
    },
    {
      note: 'Security incident response',
      groups: JSON.stringify(['HQ — Security', 'Leadership']),
      contacts: JSON.stringify([
        'emily.r@corp.com',
        'natalie.b@corp.com',
        'michelle.t@corp.com',
        'ryan.m@corp.com',
      ]),
      recipientCount: 4,
    },
  ];
  for (const h of history) await create('bridge_history', h);

  console.log('Seeding saved_locations...');
  const locations = [
    { name: 'Bowling Green, KY', lat: 36.9685, lon: -86.4808, isDefault: true },
    { name: 'New York, NY', lat: 40.7128, lon: -74.006, isDefault: false },
    { name: 'San Francisco, CA', lat: 37.7749, lon: -122.4194, isDefault: false },
  ];
  for (const l of locations) await create('saved_locations', l);

  console.log('\n✅ Seed complete!');
}

seed().catch(console.error);
