import { isConventionalSubject } from './release-version.mjs';

const title = process.env.RELAY_PULL_REQUEST_TITLE ?? '';

if (!isConventionalSubject(title)) {
  console.error(
    'Pull request title must use Conventional Commits syntax, for example: fix(updater): restore automatic installation',
  );
  process.exitCode = 1;
} else {
  console.log(`Release-compatible pull request title: ${title}`);
}
