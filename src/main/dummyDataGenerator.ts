import fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { loggers } from './logger';
import { randomUUID } from 'node:crypto';

export async function generateDummyDataAsync(targetRoot: string): Promise<boolean> {
  loggers.fileManager.debug('generateDummyDataAsync starting (JSON)', {
    path: targetRoot,
  });
  try {
    await fsPromises.mkdir(targetRoot, { recursive: true });

    const now = Date.now();

    const contacts = [
      ['Alice Johnson', 'alice@example.com', '555-0100', 'Senior Engineer'],
      ['Bob Smith', 'bob@example.com', '555-0101', 'DevOps Lead'],
      ['Charlie Brown', 'charlie@example.com', '555-0102', 'Product Manager'],
      ['Diana Prince', 'diana@example.com', '555-0103', 'Security Engineer'],
      ['Evan Wright', 'evan@example.com', '555-0104', 'Database Admin'],
      ['Fiona Lee', 'fiona@example.com', '555-0105', 'Backend Developer'],
      ['George King', 'george@example.com', '555-0106', 'Frontend Developer'],
      ['Hannah Scott', 'hannah@example.com', '555-0107', 'QA Engineer'],
      ['Ian Clark', 'ian@example.com', '555-0108', 'SRE'],
      ['Jane Doe', 'jane@example.com', '555-0109', 'Director of Engineering'],
      ['Kyle Reese', 'kyle@example.com', '555-0110', 'Incident Commander'],
      ['Laura Croft', 'laura@example.com', '555-0111', 'Network Engineer'],
      ['Mike Ross', 'mike@example.com', '555-0112', 'Legal Counsel'],
      ['Nina Patel', 'nina@example.com', '555-0113', 'HR Manager'],
      ['Oscar Wilde', 'oscar@example.com', '555-0114', 'Content Strategist'],
      ['Paul Atreides', 'paul@example.com', '555-0115', 'Operations Manager'],
      ['Quinn Fabray', 'quinn@example.com', '555-0116', 'Designer'],
      ['Rachel Green', 'rachel@example.com', '555-0117', 'Marketing Lead'],
      ['Steve Rogers', 'steve@example.com', '555-0118', 'Team Lead'],
      ['Tony Stark', 'tony@example.com', '555-0119', 'CTO'],
    ].map(([name, email, phone, title]) => ({
      id: randomUUID(),
      name,
      email,
      phone,
      title,
      createdAt: now,
      updatedAt: now,
    }));

    const groups = [
      {
        name: 'Core Engineering',
        contacts: ['alice@example.com', 'bob@example.com', 'ian@example.com', 'steve@example.com'],
      },
      {
        name: 'Product Team',
        contacts: ['charlie@example.com', 'quinn@example.com', 'rachel@example.com'],
      },
      {
        name: 'Leadership',
        contacts: ['jane@example.com', 'tony@example.com', 'mike@example.com'],
      },
      {
        name: 'DevOps',
        contacts: ['bob@example.com', 'evan@example.com', 'laura@example.com', 'kyle@example.com'],
      },
      { name: 'Frontend Guild', contacts: ['george@example.com', 'fiona@example.com'] },
    ].map((g) => ({
      ...g,
      id: `group_${now}_${randomUUID().split('-')[0]}`,
      createdAt: now,
      updatedAt: now,
    }));

    const servers = [
      [
        'web-prod-01',
        'eCommerce',
        'Storefront',
        'Primary web server',
        'alice@example.com',
        'steve@example.com',
        'Linux',
      ],
      [
        'web-prod-02',
        'eCommerce',
        'Storefront',
        'Secondary web server',
        'alice@example.com',
        'steve@example.com',
        'Linux',
      ],
      [
        'db-primary',
        'Data Services',
        'Core Data',
        'Main production DB',
        'evan@example.com',
        'laura@example.com',
        'Linux',
      ],
      [
        'db-replica',
        'Data Services',
        'Core Data',
        'Read replica',
        'evan@example.com',
        'laura@example.com',
        'Linux',
      ],
      [
        'cache-cluster',
        'Platform',
        'Caching',
        'Session cache',
        'bob@example.com',
        'kyle@example.com',
        'Linux',
      ],
      [
        'monitoring',
        'Platform',
        'Observability',
        'Metrics dashboard',
        'ian@example.com',
        'ian@example.com',
        'Linux',
      ],
      [
        'ci-runner',
        'DevOps',
        'CI/CD',
        'Build agent',
        'bob@example.com',
        'kyle@example.com',
        'Linux',
      ],
      [
        'staging-web',
        'eCommerce',
        'Storefront',
        'Staging environment',
        'fiona@example.com',
        'steve@example.com',
        'Linux',
      ],
      [
        'bastion-host',
        'Security',
        'InfraSec',
        'Jump box',
        'diana@example.com',
        'diana@example.com',
        'Linux',
      ],
      [
        'backup-server',
        'IT Ops',
        'Backups',
        'Daily backups location',
        'kyle@example.com',
        'kyle@example.com',
        'Windows',
      ],
    ].map(([name, businessArea, lob, comment, owner, contact, os]) => ({
      id: randomUUID(),
      name,
      businessArea,
      lob,
      comment,
      owner,
      contact,
      os,
      createdAt: now,
      updatedAt: now,
    }));

    const onCall = [
      ['SRE', 'Primary', 'Ian Clark', '555-0108', '9am - 5pm'],
      ['SRE', 'Secondary', 'Kyle Reese', '555-0110', '9am - 5pm'],
      ['SRE', 'Backup', 'Bob Smith', '555-0101', 'Off-hours'],
      ['Platform', 'Primary', 'Alice Johnson', '555-0100', '24/7'],
      ['Platform', 'Shadow', 'Steve Rogers', '555-0118', '9am - 5pm'],
      ['Security', 'Primary', 'Diana Prince', '555-0103', '24/7'],
      ['Security', 'Escalation', 'Tony Stark', '555-0119', 'Always'],
      ['Data', 'Primary', 'Evan Wright', '555-0104', '8am - 4pm'],
    ].map(([team, role, name, contact, timeWindow]) => ({
      id: randomUUID(),
      team,
      role,
      name,
      contact,
      timeWindow,
      createdAt: now,
      updatedAt: now,
    }));

    await fsPromises.writeFile(
      join(targetRoot, 'contacts.json'),
      JSON.stringify(contacts, null, 2),
      'utf-8',
    );
    await fsPromises.writeFile(
      join(targetRoot, 'bridgeGroups.json'),
      JSON.stringify(groups, null, 2),
      'utf-8',
    );
    await fsPromises.writeFile(
      join(targetRoot, 'servers.json'),
      JSON.stringify(servers, null, 2),
      'utf-8',
    );
    await fsPromises.writeFile(
      join(targetRoot, 'oncall.json'),
      JSON.stringify(onCall, null, 2),
      'utf-8',
    );

    return true;
  } catch (e) {
    loggers.fileManager.error('generateDummyData error', { error: e });
    return false;
  }
}
