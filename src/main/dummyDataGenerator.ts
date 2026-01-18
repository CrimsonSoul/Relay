import fsPromises from 'fs/promises';
import { join } from 'path';
import { logger } from './logger';
import { randomUUID } from 'crypto';

export async function generateDummyDataAsync(targetRoot: string): Promise<boolean> {
  logger.debug('DummyDataGenerator', 'generateDummyDataAsync starting (JSON)', { path: targetRoot });
  try {
    await fsPromises.mkdir(targetRoot, { recursive: true });

    const now = Date.now();

    const contacts = [
      { name: 'Alice Johnson', email: 'alice@example.com', phone: '555-0100', title: 'Senior Engineer' },
      { name: 'Bob Smith', email: 'bob@example.com', phone: '555-0101', title: 'DevOps Lead' },
      { name: 'Charlie Brown', email: 'charlie@example.com', phone: '555-0102', title: 'Product Manager' },
      { name: 'Diana Prince', email: 'diana@example.com', phone: '555-0103', title: 'Security Engineer' },
      { name: 'Evan Wright', email: 'evan@example.com', phone: '555-0104', title: 'Database Admin' },
      { name: 'Fiona Lee', email: 'fiona@example.com', phone: '555-0105', title: 'Backend Developer' },
      { name: 'George King', email: 'george@example.com', phone: '555-0106', title: 'Frontend Developer' },
      { name: 'Hannah Scott', email: 'hannah@example.com', phone: '555-0107', title: 'QA Engineer' },
      { name: 'Ian Clark', email: 'ian@example.com', phone: '555-0108', title: 'SRE' },
      { name: 'Jane Doe', email: 'jane@example.com', phone: '555-0109', title: 'Director of Engineering' },
      { name: 'Kyle Reese', email: 'kyle@example.com', phone: '555-0110', title: 'Incident Commander' },
      { name: 'Laura Croft', email: 'laura@example.com', phone: '555-0111', title: 'Network Engineer' },
      { name: 'Mike Ross', email: 'mike@example.com', phone: '555-0112', title: 'Legal Counsel' },
      { name: 'Nina Patel', email: 'nina@example.com', phone: '555-0113', title: 'HR Manager' },
      { name: 'Oscar Wilde', email: 'oscar@example.com', phone: '555-0114', title: 'Content Strategist' },
      { name: 'Paul Atreides', email: 'paul@example.com', phone: '555-0115', title: 'Operations Manager' },
      { name: 'Quinn Fabray', email: 'quinn@example.com', phone: '555-0116', title: 'Designer' },
      { name: 'Rachel Green', email: 'rachel@example.com', phone: '555-0117', title: 'Marketing Lead' },
      { name: 'Steve Rogers', email: 'steve@example.com', phone: '555-0118', title: 'Team Lead' },
      { name: 'Tony Stark', email: 'tony@example.com', phone: '555-0119', title: 'CTO' }
    ].map(c => ({ ...c, id: randomUUID(), createdAt: now, updatedAt: now }));

    const groups = [
      { name: 'Core Engineering', contacts: ['alice@example.com', 'bob@example.com', 'ian@example.com', 'steve@example.com'] },
      { name: 'Product Team', contacts: ['charlie@example.com', 'quinn@example.com', 'rachel@example.com'] },
      { name: 'Leadership', contacts: ['jane@example.com', 'tony@example.com', 'mike@example.com'] },
      { name: 'DevOps', contacts: ['bob@example.com', 'evan@example.com', 'laura@example.com', 'kyle@example.com'] },
      { name: 'Frontend Guild', contacts: ['george@example.com', 'fiona@example.com'] }
    ].map(g => ({ ...g, id: `group_${now}_${randomUUID().split('-')[0]}`, createdAt: now, updatedAt: now }));

    const servers = [
      { name: 'web-prod-01', businessArea: 'eCommerce', lob: 'Storefront', comment: 'Primary web server', owner: 'alice@example.com', contact: 'steve@example.com', os: 'Linux' },
      { name: 'web-prod-02', businessArea: 'eCommerce', lob: 'Storefront', comment: 'Secondary web server', owner: 'alice@example.com', contact: 'steve@example.com', os: 'Linux' },
      { name: 'db-primary', businessArea: 'Data Services', lob: 'Core Data', comment: 'Main production DB', owner: 'evan@example.com', contact: 'laura@example.com', os: 'Linux' },
      { name: 'db-replica', businessArea: 'Data Services', lob: 'Core Data', comment: 'Read replica', owner: 'evan@example.com', contact: 'laura@example.com', os: 'Linux' },
      { name: 'cache-cluster', businessArea: 'Platform', lob: 'Caching', comment: 'Session cache', owner: 'bob@example.com', contact: 'kyle@example.com', os: 'Linux' },
      { name: 'monitoring', businessArea: 'Platform', lob: 'Observability', comment: 'Metrics dashboard', owner: 'ian@example.com', contact: 'ian@example.com', os: 'Linux' },
      { name: 'ci-runner', businessArea: 'DevOps', lob: 'CI/CD', comment: 'Build agent', owner: 'bob@example.com', contact: 'kyle@example.com', os: 'Linux' },
      { name: 'staging-web', businessArea: 'eCommerce', lob: 'Storefront', comment: 'Staging environment', owner: 'fiona@example.com', contact: 'steve@example.com', os: 'Linux' },
      { name: 'bastion-host', businessArea: 'Security', lob: 'InfraSec', comment: 'Jump box', owner: 'diana@example.com', contact: 'diana@example.com', os: 'Linux' },
      { name: 'backup-server', businessArea: 'IT Ops', lob: 'Backups', comment: 'Daily backups location', owner: 'kyle@example.com', contact: 'kyle@example.com', os: 'Windows' }
    ].map(s => ({ ...s, id: randomUUID(), createdAt: now, updatedAt: now }));

    const onCall = [
      { team: 'SRE', role: 'Primary', name: 'Ian Clark', contact: '555-0108', timeWindow: '9am - 5pm' },
      { team: 'SRE', role: 'Secondary', name: 'Kyle Reese', contact: '555-0110', timeWindow: '9am - 5pm' },
      { team: 'SRE', role: 'Backup', name: 'Bob Smith', contact: '555-0101', timeWindow: 'Off-hours' },
      { team: 'Platform', role: 'Primary', name: 'Alice Johnson', contact: '555-0100', timeWindow: '24/7' },
      { team: 'Platform', role: 'Shadow', name: 'Steve Rogers', contact: '555-0118', timeWindow: '9am - 5pm' },
      { team: 'Security', role: 'Primary', name: 'Diana Prince', contact: '555-0103', timeWindow: '24/7' },
      { team: 'Security', role: 'Escalation', name: 'Tony Stark', contact: '555-0119', timeWindow: 'Always' },
      { team: 'Data', role: 'Primary', name: 'Evan Wright', contact: '555-0104', timeWindow: '8am - 4pm' }
    ].map(o => ({ ...o, id: randomUUID(), createdAt: now, updatedAt: now }));

    await fsPromises.writeFile(join(targetRoot, 'contacts.json'), JSON.stringify(contacts, null, 2), 'utf-8');
    await fsPromises.writeFile(join(targetRoot, 'bridgeGroups.json'), JSON.stringify(groups, null, 2), 'utf-8');
    await fsPromises.writeFile(join(targetRoot, 'servers.json'), JSON.stringify(servers, null, 2), 'utf-8');
    await fsPromises.writeFile(join(targetRoot, 'oncall.json'), JSON.stringify(onCall, null, 2), 'utf-8');

    return true;
  } catch (e) {
    logger.error('DummyDataGenerator', 'generateDummyData error', { error: e });
    return false;
  }
}
