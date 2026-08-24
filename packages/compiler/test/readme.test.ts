import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { postgresSnapshot, supabaseSnapshot, toolSnapshot, trivialSnapshot } from './fixtures';

/**
 * The README every project carries (`docs/25-readme.md`).
 *
 * It is written from the project, so the risk is not that it reads badly — it is that it says
 * something the repo does not do. These check its claims against the files beside it: the scripts
 * it tells you to run, the names it tells you to set, and the paths it tells you to look in.
 */

const readme = (snapshot: Snapshot): string => {
  const file = compile(snapshot).files.find((entry) => entry.path === 'README.md');
  if (!file) throw new Error('no README emitted');
  return file.content;
};

describe('every project gets one', () => {
  it('names the project and says what it is', () => {
    const text = readme(trivialSnapshot());
    expect(text.startsWith('# Sample')).toBe(true);
    expect(text).toContain('Built with loom');
    // The claim that matters to whoever inherits it.
    expect(text).toContain('nothing in it depends on');
  });

  it('even for a project with no routes and no credentials', () => {
    const text = readme(trivialSnapshot());
    expect(text).toContain('npm install');
    // Nothing to fill in, so nothing is asked for.
    expect(text).not.toContain('## What it needs');
    expect(text).not.toContain('### API routes');
  });
});

describe('the commands it tells you to run', () => {
  it('are the scripts the package.json actually has', () => {
    const files = compile(supabaseSnapshot()).files;
    const scripts = (
      JSON.parse(files.find((file) => file.path === 'package.json')!.content) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    const text = files.find((file) => file.path === 'README.md')!.content;

    // A README naming a script that does not exist is worse than no README.
    for (const command of ['npm run dev', 'npm run build', 'npm start']) {
      expect(text).toContain(command);
    }
    expect(scripts.dev).toBeDefined();
    expect(scripts.build).toBeDefined();
    expect(scripts.start).toBeDefined();
  });

  it('mentions the container files that are actually emitted', () => {
    const files = compile(supabaseSnapshot()).files.map((file) => file.path);
    expect(readme(supabaseSnapshot())).toContain('docker compose up --build');
    expect(files).toContain('docker-compose.yml');
    expect(files).toContain('Dockerfile');
  });
});

describe('the names it tells you to set', () => {
  it('are exactly the ones .env.example asks for', () => {
    const files = compile(toolSnapshot('twilio', 'sms')).files;
    const example = files.find((file) => file.path === '.env.example')!.content;
    const text = files.find((file) => file.path === 'README.md')!.content;

    const names = example
      .split('\n')
      .map((line) => line.split('=')[0])
      .filter((name): name is string => Boolean(name));

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(text).toContain(`\`${name}\``);
  });

  it('says what each one is, rather than leaving a blank to guess at', () => {
    const text = readme(postgresSnapshot());
    expect(text).toContain('`DATABASE_URL`');
    expect(text).toContain('pooled');
  });

  it('is plain that values are never committed', () => {
    expect(readme(supabaseSnapshot())).toContain('No value is ever committed');
  });
});

describe('the map it gives you', () => {
  it('lists the screens that exist, at the paths they answer on', () => {
    const text = readme(supabaseSnapshot());
    expect(text).toContain('`/` → `src/artboards/Home.tsx`');
  });

  it('lists the routes that were emitted, and says where they run', () => {
    const files = compile(supabaseSnapshot()).files;
    const text = files.find((file) => file.path === 'README.md')!.content;

    for (const file of files.filter((entry) => entry.path.startsWith('api/'))) {
      expect(text).toContain(`\`${file.path}\``);
    }
    // The thing a developer needs to know before they move one.
    expect(text).toContain('runs **on the server**');
  });

  it('mentions migrations only when there are some', () => {
    expect(readme(supabaseSnapshot())).not.toContain('## The database');

    const withMigration = applyOps(postgresSnapshot(), [
      {
        type: 'recordMigration',
        migration: {
          id: 'mg_one',
          index: 1,
          description: 'create table notes',
          appliedAt: '2026-08-24T10:00:00.000Z',
          statements: ['create table "notes" ()'],
        },
      },
    ]);
    const text = readme(withMigration);
    expect(text).toContain('`migrations/` holds 1 schema change');
    // And there is no runner bundled, which is a choice worth stating.
    expect(text).toContain('no migration tool bundled');
  });
});

describe('what it warns about', () => {
  it('says regenerating overwrites the files loom manages', () => {
    // The one way to lose work with this repo.
    expect(readme(trivialSnapshot())).toContain('Regenerating overwrites it');
  });

  it('never carries a credential value itself', () => {
    const text = readme(toolSnapshot('stripe', 'checkout'));
    expect(text).not.toMatch(/sk_[A-Za-z0-9]{6}/);
    expect(text).toContain('`STRIPE_SECRET_KEY`');
  });
});
