import fs from 'fs';
import fsPromises from 'fs/promises';
import { join } from 'path';
import { app } from 'electron';

// Default headers for each file type - used when creating new files
const DEFAULT_HEADERS: Record<string, string> = {
  'groups.csv': 'Group,Members',
  'contacts.csv': 'Name,Email,Phone,Title',
  'servers.csv': 'Server,IP,Port,Protocol,Owner,Comment',
  'oncall.csv': 'Team,Primary,Backup,Label'
};

// Async version for non-blocking startup
// IMPORTANT: Never copies bundled sample data - only creates empty files with headers
export async function ensureDataFilesAsync(targetRoot: string, bundledDataPath: string, isPackaged: boolean) {
  // Always ensure directory exists, even in dev
  try {
    await fsPromises.mkdir(targetRoot, { recursive: true });
  } catch (e) {
    console.error('Failed to create persistent data directory:', e);
  }

  // Ensure groups.csv and contacts.csv exist - create with headers only, never copy bundled data
  const files = ['groups.csv', 'contacts.csv'];
  for (const file of files) {
    const targetPath = join(targetRoot, file);
    try {
      await fsPromises.access(targetPath);
      // File exists, skip
    } catch {
      // File doesn't exist - create empty file with headers only (NO bundled data)
      try {
        const headers = DEFAULT_HEADERS[file] || '';
        await fsPromises.writeFile(targetPath, headers + '\n', 'utf-8');
        console.log(`[dataUtils] Created empty ${file} with headers only (no sample data)`);
      } catch (e) {
        console.error(`Failed to create ${file}:`, e);
      }
    }
  }
}

// Sync version for compatibility (used during path changes)
// IMPORTANT: Never copies bundled sample data - only creates empty files with headers
export function ensureDataFiles(targetRoot: string, bundledDataPath: string, isPackaged: boolean) {
  // Always ensure directory exists, even in dev (if we switch to using appData in dev too)
  if (!fs.existsSync(targetRoot)) {
    try {
      fs.mkdirSync(targetRoot, { recursive: true });
    } catch (e) {
      console.error('Failed to create persistent data directory:', e);
    }
  }

  // Ensure groups.csv and contacts.csv exist - create with headers only, never copy bundled data
  const files = ['groups.csv', 'contacts.csv'];
  for (const file of files) {
    const targetPath = join(targetRoot, file);
    if (!fs.existsSync(targetPath)) {
      // Create empty file with headers only (NO bundled data to prevent contamination)
      try {
        const headers = DEFAULT_HEADERS[file] || '';
        fs.writeFileSync(targetPath, headers + '\n', 'utf-8');
        console.log(`[dataUtils] Created empty ${file} with headers only (no sample data)`);
      } catch (e) {
        console.error(`Failed to create ${file}:`, e);
      }
    }
  }
}

// Async version for non-blocking file copying with parallel operations
// IMPORTANT: Never falls back to bundled sample data - creates empty files with headers instead
export async function copyDataFilesAsync(sourceRoot: string, targetRoot: string, bundledDataPath: string): Promise<boolean> {
  const essentialFiles = ['contacts.csv', 'groups.csv', 'oncall.csv', 'history.json'];

  // Ensure target exists
  try {
    await fsPromises.mkdir(targetRoot, { recursive: true });
  } catch (e) {
    console.error('Failed to create target directory:', e);
  }

  // Build array of copy operations to run in parallel
  const copyOperations: Promise<boolean>[] = essentialFiles.map(async (file) => {
    const source = join(sourceRoot, file);
    const target = join(targetRoot, file);

    // Check if target exists
    try {
      await fsPromises.access(target);
      return false; // Target exists, skip
    } catch {
      // Target doesn't exist, proceed
    }

    // Try sourceRoot first (user's existing data)
    try {
      await fsPromises.access(source);
      await fsPromises.copyFile(source, target);
      console.log(`Copied ${file} from ${sourceRoot} to ${targetRoot}`);
      return true;
    } catch {
      // Source doesn't exist - create empty file with headers (NO bundled data)
      const headers = DEFAULT_HEADERS[file];
      if (headers) {
        try {
          await fsPromises.writeFile(target, headers + '\n', 'utf-8');
          console.log(`Created empty ${file} with headers only (no sample data)`);
          return true;
        } catch {
          // Failed to create
        }
      }
      return false;
    }
  });

  // Execute all copy operations in parallel
  const results = await Promise.all(copyOperations);
  return results.some(copied => copied);
}

// Sync version for compatibility (used during path changes)
// IMPORTANT: Never falls back to bundled sample data - creates empty files with headers instead
export function copyDataFiles(sourceRoot: string, targetRoot: string, bundledDataPath: string) {
  const essentialFiles = ['contacts.csv', 'groups.csv', 'oncall.csv', 'history.json'];
  let filesCopied = false;

  // Ensure target exists
  if (!fs.existsSync(targetRoot)) {
    try { fs.mkdirSync(targetRoot, { recursive: true }); } catch (e) { console.error(e); }
  }

  for (const file of essentialFiles) {
    const source = join(sourceRoot, file);
    const target = join(targetRoot, file);
    // Only copy if target DOES NOT exist
    if (!fs.existsSync(target)) {
      // Try sourceRoot (user's existing data)
      if (fs.existsSync(source)) {
        try {
          fs.copyFileSync(source, target);
          filesCopied = true;
          console.log(`Copied ${file} from ${sourceRoot} to ${targetRoot}`);
        } catch (e) {
          console.error(`Failed to copy ${file}:`, e);
        }
      } else {
        // Source doesn't exist - create empty file with headers (NO bundled data)
        const headers = DEFAULT_HEADERS[file];
        if (headers) {
          try {
            fs.writeFileSync(target, headers + '\n', 'utf-8');
            filesCopied = true;
            console.log(`Created empty ${file} with headers only (no sample data)`);
          } catch (e) {
            console.error(`Failed to create ${file}:`, e);
          }
        }
      }
    }
  }
  return filesCopied;
}

// Async version for non-blocking startup
export async function loadConfigAsync(): Promise<{ dataRoot?: string }> {
  try {
    const configPath = join(app.getPath('userData'), 'config.json');
    try {
      const content = await fsPromises.readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      // File doesn't exist
      return {};
    }
  } catch (error) {
    console.error('Failed to load config:', error);
    return {};
  }
}

// Sync version for compatibility
export function loadConfig(): { dataRoot?: string } {
  try {
    const configPath = join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return {};
}

// Async version for non-blocking config save
export async function saveConfigAsync(config: { dataRoot?: string }): Promise<void> {
  try {
    const configPath = join(app.getPath('userData'), 'config.json');
    await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

export async function generateDummyDataAsync(targetRoot: string): Promise<boolean> {
  console.log('[dataUtils] generateDummyDataAsync starting for:', targetRoot);
  try {
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
      'Server,IP,Port,Protocol,Owner,Comment',
      'web-prod-01,10.0.1.10,443,HTTPS,alice@example.com,Primary web server',
      'web-prod-02,10.0.1.11,443,HTTPS,alice@example.com,Secondary web server',
      'db-primary,10.0.2.50,5432,PostgreSQL,evan@example.com,Main production DB',
      'db-replica,10.0.2.51,5432,PostgreSQL,evan@example.com,Read replica',
      'cache-cluster,10.0.3.10,6379,Redis,bob@example.com,Session cache',
      'monitoring,10.0.4.5,3000,Grafana,ian@example.com,Metrics dashboard',
      'ci-runner,10.0.5.20,22,SSH,bob@example.com,Build agent',
      'staging-web,10.1.1.10,80,HTTP,fiona@example.com,Staging environment',
      'bastion-host,10.0.0.1,22,SSH,diana@example.com,Jump box',
      'backup-server,10.0.6.100,445,SMB,kyle@example.com,Daily backups location'
    ].join('\n');

    // On-Call: Team, Role, Name, Contact, Time Window
    // We'll generate a few teams.
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
    console.error('[dataUtils] generateDummyData error:', e);
    return false;
  }
}

// Sync version for compatibility
export function saveConfig(config: { dataRoot?: string }) {
  try {
    const configPath = join(app.getPath('userData'), 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}
