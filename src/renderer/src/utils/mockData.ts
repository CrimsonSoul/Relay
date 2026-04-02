import { AppData, Contact, Server } from '@shared/ipc';

// Dev-only mock data for browser preview (no Electron API available)

function mkContact(
  name: string,
  email: string,
  phone: string,
  title: string,
  now: number,
): Contact {
  return {
    name,
    email,
    phone,
    title,
    _searchString: `${name} ${email} ${phone} ${title}`.toLowerCase(),
    raw: { id: crypto.randomUUID(), createdAt: now, updatedAt: now },
  };
}

function mkServer(opts: {
  name: string;
  ba: string;
  lob: string;
  comment: string;
  owner: string;
  contact: string;
  os: string;
  now: number;
}): Server {
  const { name, ba, lob, comment, owner, contact, os, now } = opts;
  return {
    name,
    businessArea: ba,
    lob,
    comment,
    owner,
    contact,
    os,
    _searchString: `${name} ${ba} ${lob} ${comment} ${owner} ${contact} ${os}`.toLowerCase(),
    raw: { id: crypto.randomUUID(), createdAt: now, updatedAt: now },
  };
}

export function getDevMockData(): AppData {
  const now = Date.now();

  const contacts = [
    mkContact('Alice Johnson', 'alice@example.com', '555-0100', 'Senior Engineer', now),
    mkContact('Bob Smith', 'bob@example.com', '555-0101', 'DevOps Lead', now),
    mkContact('Charlie Brown', 'charlie@example.com', '555-0102', 'Product Manager', now),
    mkContact('Diana Prince', 'diana@example.com', '555-0103', 'Security Engineer', now),
    mkContact('Evan Wright', 'evan@example.com', '555-0104', 'Database Admin', now),
    mkContact('Fiona Lee', 'fiona@example.com', '555-0105', 'Backend Developer', now),
    mkContact('George King', 'george@example.com', '555-0106', 'Frontend Developer', now),
    mkContact('Hannah Scott', 'hannah@example.com', '555-0107', 'QA Engineer', now),
    mkContact('Ian Clark', 'ian@example.com', '555-0108', 'SRE', now),
    mkContact('Jane Doe', 'jane@example.com', '555-0109', 'Director of Engineering', now),
    mkContact('Kyle Reese', 'kyle@example.com', '555-0110', 'Incident Commander', now),
    mkContact('Laura Croft', 'laura@example.com', '555-0111', 'Network Engineer', now),
    mkContact('Mike Ross', 'mike@example.com', '555-0112', 'Legal Counsel', now),
    mkContact('Nina Patel', 'nina@example.com', '555-0113', 'HR Manager', now),
    mkContact('Oscar Wilde', 'oscar@example.com', '555-0114', 'Content Strategist', now),
    mkContact('Paul Atreides', 'paul@example.com', '555-0115', 'Operations Manager', now),
    mkContact('Quinn Fabray', 'quinn@example.com', '555-0116', 'Designer', now),
    mkContact('Rachel Green', 'rachel@example.com', '555-0117', 'Marketing Lead', now),
    mkContact('Steve Rogers', 'steve@example.com', '555-0118', 'Team Lead', now),
    mkContact('Tony Stark', 'tony@example.com', '555-0119', 'CTO', now),
  ];

  const groups = [
    {
      id: 'g1',
      name: 'Core Engineering',
      contacts: ['alice@example.com', 'bob@example.com', 'ian@example.com', 'steve@example.com'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'g2',
      name: 'Product Team',
      contacts: ['charlie@example.com', 'quinn@example.com', 'rachel@example.com'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'g3',
      name: 'Leadership',
      contacts: ['jane@example.com', 'tony@example.com', 'mike@example.com'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'g4',
      name: 'DevOps',
      contacts: ['bob@example.com', 'evan@example.com', 'laura@example.com', 'kyle@example.com'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'g5',
      name: 'Frontend Guild',
      contacts: ['george@example.com', 'fiona@example.com'],
      createdAt: now,
      updatedAt: now,
    },
  ];

  const servers = [
    mkServer({
      name: 'web-prod-01',
      ba: 'eCommerce',
      lob: 'Storefront',
      comment: 'Primary web server',
      owner: 'alice@example.com',
      contact: 'steve@example.com',
      os: 'Linux',
      now,
    }),
    mkServer({
      name: 'web-prod-02',
      ba: 'eCommerce',
      lob: 'Storefront',
      comment: 'Secondary web server',
      owner: 'alice@example.com',
      contact: 'steve@example.com',
      os: 'Linux',
      now,
    }),
    mkServer({
      name: 'db-primary',
      ba: 'Data Services',
      lob: 'Core Data',
      comment: 'Main production DB',
      owner: 'evan@example.com',
      contact: 'laura@example.com',
      os: 'Linux',
      now,
    }),
    mkServer({
      name: 'db-replica',
      ba: 'Data Services',
      lob: 'Core Data',
      comment: 'Read replica',
      owner: 'evan@example.com',
      contact: 'laura@example.com',
      os: 'Linux',
      now,
    }),
    mkServer({
      name: 'cache-cluster',
      ba: 'Platform',
      lob: 'Caching',
      comment: 'Session cache',
      owner: 'bob@example.com',
      contact: 'kyle@example.com',
      os: 'Linux',
      now,
    }),
    mkServer({
      name: 'monitoring',
      ba: 'Platform',
      lob: 'Observability',
      comment: 'Metrics dashboard',
      owner: 'ian@example.com',
      contact: 'ian@example.com',
      os: 'Linux',
      now,
    }),
    mkServer({
      name: 'ci-runner',
      ba: 'DevOps',
      lob: 'CI/CD',
      comment: 'Build agent',
      owner: 'bob@example.com',
      contact: 'kyle@example.com',
      os: 'Linux',
      now,
    }),
    mkServer({
      name: 'staging-web',
      ba: 'eCommerce',
      lob: 'Storefront',
      comment: 'Staging environment',
      owner: 'fiona@example.com',
      contact: 'steve@example.com',
      os: 'Linux',
      now,
    }),
    mkServer({
      name: 'bastion-host',
      ba: 'Security',
      lob: 'InfraSec',
      comment: 'Jump box',
      owner: 'diana@example.com',
      contact: 'diana@example.com',
      os: 'Linux',
      now,
    }),
    mkServer({
      name: 'backup-server',
      ba: 'IT Ops',
      lob: 'Backups',
      comment: 'Daily backups location',
      owner: 'kyle@example.com',
      contact: 'kyle@example.com',
      os: 'Windows',
      now,
    }),
  ];

  const onCall = [
    {
      id: 'oc1',
      team: 'SRE',
      role: 'Primary',
      name: 'Ian Clark',
      contact: '555-0108',
      timeWindow: '9am - 5pm',
    },
    {
      id: 'oc2',
      team: 'SRE',
      role: 'Secondary',
      name: 'Kyle Reese',
      contact: '555-0110',
      timeWindow: '9am - 5pm',
    },
    {
      id: 'oc3',
      team: 'SRE',
      role: 'Backup',
      name: 'Bob Smith',
      contact: '555-0101',
      timeWindow: 'Off-hours',
    },
    {
      id: 'oc4',
      team: 'Platform',
      role: 'Primary',
      name: 'Alice Johnson',
      contact: '555-0100',
      timeWindow: '24/7',
    },
    {
      id: 'oc5',
      team: 'Platform',
      role: 'Shadow',
      name: 'Steve Rogers',
      contact: '555-0118',
      timeWindow: '9am - 5pm',
    },
    {
      id: 'oc6',
      team: 'Security',
      role: 'Primary',
      name: 'Diana Prince',
      contact: '555-0103',
      timeWindow: '24/7',
    },
    {
      id: 'oc7',
      team: 'Security',
      role: 'Escalation',
      name: 'Tony Stark',
      contact: '555-0119',
      timeWindow: 'Always',
    },
    {
      id: 'oc8',
      team: 'Data',
      role: 'Primary',
      name: 'Evan Wright',
      contact: '555-0104',
      timeWindow: '8am - 4pm',
    },
  ];

  return { groups, contacts, servers, onCall, lastUpdated: now };
}
