import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const pathKey = (env) => Object.keys(env).find((key) => key.toUpperCase() === 'PATH');

/**
 * `env` with `directory` searched first. Windows spells the variable `Path`, and two spellings
 * would collide.
 */
export function withPathPrepended(env, directory) {
  const { [pathKey(env) ?? 'PATH']: current = '', ...rest } = env;
  return { ...rest, PATH: `${directory}${delimiter}${current}` };
}

// <Git>/mingw64/libexec/git-core → <Git>
function findGitForWindows() {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  const root = git.status === 0 ? join(git.stdout.trim(), '..', '..', '..') : '';
  if (!root || !existsSync(join(root, 'usr', 'bin', 'bash.exe'))) {
    throw new Error('Workflow contract tests on Windows need Git for Windows.');
  }
  return root;
}

/**
 * Runs a GitHub Actions `run:` snippet with bash, as the workflow does. Linux and macOS use
 * /bin/bash. Windows uses Git for Windows' bash (System32\bash.exe is WSL, another filesystem)
 * with Git's tools after the caller's PATH, so a test's fake commands still win, the way bash's
 * default PATH backs a runner's minimal environment.
 */
export function runWorkflowBash(args, options = {}) {
  if (process.platform !== 'win32') return spawnSync('/bin/bash', args, options);
  const git = findGitForWindows();
  const env = options.env ?? process.env;
  // core_perl holds shasum; Git's login profile adds it, but these shells skip the profile.
  const tools = [
    join(git, 'usr', 'bin'),
    join(git, 'usr', 'bin', 'core_perl'),
    join(git, 'mingw64', 'bin'),
  ].join(delimiter);
  const { [pathKey(env) ?? 'PATH']: current, ...rest } = env;
  return spawnSync(join(git, 'usr', 'bin', 'bash.exe'), args, {
    ...options,
    env: {
      // Windows cannot start a process without SystemRoot.
      SystemRoot: process.env.SystemRoot,
      ...rest,
      PATH: current ? `${current}${delimiter}${tools}` : tools,
    },
  });
}
