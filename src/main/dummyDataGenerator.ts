import fsPromises from 'fs/promises';
import { join } from 'path';
import { logger } from './logger';

export async function generateDummyDataAsync(targetRoot: string): Promise<boolean> {
  logger.debug('DummyDataGenerator', 'generateDummyDataAsync starting', { path: targetRoot });
  try {
    await fsPromises.mkdir(targetRoot, { recursive: true });

    const contactsCsv = [
      'Name,Email,Phone,Title',
      'Alice Johnson,alice@example.com,555-0100,Senior Engineer',
      'Bob Smith,bob@example.com,555-0101,DevOps Lead',
      'Charlie Brown,charlie@example.com,555-0102,Product Manager',
      'Diana Prince,diana@example.com,555-0103,Security Engineer',
      'Evan Wright,evan@example.com,555-0104,Database Admin',
      'Fiona Lee,fiona@example.com,555-0105,Backend Developer',
      'George King,george@example.com,555-0106,Frontend Developer',
      'Hannah Scott,hannah@example.com,555-0107,QA Engineer',
      'Ian Clark,ian@example.com,555-0108,SRE',
      'Jane Doe,jane@example.com,555-0109,Director of Engineering',
      'Kyle Reese,kyle@example.com,555-0110,Incident Commander',
      'Laura Croft,laura@example.com,555-0111,Network Engineer',
      'Mike Ross,mike@example.com,555-0112,Legal Counsel',
      'Nina Patel,nina@example.com,555-0113,HR Manager',
      'Oscar Wilde,oscar@example.com,555-0114,Content Strategist',
      'Paul Atreides,paul@example.com,555-0115,Operations Manager',
      'Quinn Fabray,quinn@example.com,555-0116,Designer',
      'Rachel Green,rachel@example.com,555-0117,Marketing Lead',
      'Steve Rogers,steve@example.com,555-0118,Team Lead',
      'Tony Stark,tony@example.com,555-0119,CTO'
    ].join('\n');

    const groupsCsv = [
      'Group,Members',
      'Core Engineering,alice@example.com;bob@example.com;ian@example.com;steve@example.com',
      'Product Team,charlie@example.com;quinn@example.com;rachel@example.com',
      'Leadership,jane@example.com;tony@example.com;mike@example.com',
      'DevOps,bob@example.com;evan@example.com;laura@example.com;kyle@example.com',
      'Frontend Guild,george@example.com;fiona@example.com'
    ].join('\n');

    const serversCsv = [
      'Name,Business Area,LOB,Comment,Owner,IT Contact,OS',
      'web-prod-01,eCommerce,Storefront,Primary web server,alice@example.com,steve@example.com,Linux',
      'web-prod-02,eCommerce,Storefront,Secondary web server,alice@example.com,steve@example.com,Linux',
      'db-primary,Data Services,Core Data,Main production DB,evan@example.com,laura@example.com,Linux',
      'db-replica,Data Services,Core Data,Read replica,evan@example.com,laura@example.com,Linux',
      'cache-cluster,Platform,Caching,Session cache,bob@example.com,kyle@example.com,Linux',
      'monitoring,Platform,Observability,Metrics dashboard,ian@example.com,ian@example.com,Linux',
      'ci-runner,DevOps,CI/CD,Build agent,bob@example.com,kyle@example.com,Linux',
      'staging-web,eCommerce,Storefront,Staging environment,fiona@example.com,steve@example.com,Linux',
      'bastion-host,Security,InfraSec,Jump box,diana@example.com,diana@example.com,Linux',
      'backup-server,IT Ops,Backups,Daily backups location,kyle@example.com,kyle@example.com,Windows'
    ].join('\n');

    const onCallCsv = [
      'Team,Role,Name,Contact,Time Window',
      'SRE,Primary,Ian Clark,555-0108,9am - 5pm',
      'SRE,Secondary,Kyle Reese,555-0110,9am - 5pm',
      'SRE,Backup,Bob Smith,555-0101,Off-hours',
      'Platform,Primary,Alice Johnson,555-0100,24/7',
      'Platform,Shadow,Steve Rogers,555-0118,9am - 5pm',
      'Security,Primary,Diana Prince,555-0103,24/7',
      'Security,Escalation,Tony Stark,555-0119,Always',
      'Data,Primary,Evan Wright,555-0104,8am - 4pm'
    ].join('\n');

    await fsPromises.writeFile(join(targetRoot, 'contacts.csv'), contactsCsv, 'utf-8');
    await fsPromises.writeFile(join(targetRoot, 'groups.csv'), groupsCsv, 'utf-8');
    await fsPromises.writeFile(join(targetRoot, 'servers.csv'), serversCsv, 'utf-8');
    await fsPromises.writeFile(join(targetRoot, 'oncall.csv'), onCallCsv, 'utf-8');

    return true;
  } catch (e) {
    logger.error('DummyDataGenerator', 'generateDummyData error', { error: e });
    return false;
  }
}
