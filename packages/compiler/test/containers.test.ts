import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@loom/ir';
import { compile } from '../src/index';
import { postgresSnapshot, supabaseSnapshot, trivialSnapshot } from './fixtures';

/**
 * Running the emitted app in a container (C1, `docs/18-containers.md`).
 *
 * The server these files run is checked for real in the smoke gates — it serves the built app and
 * answers a route. What is left here is what a container adds around it, and the two things that
 * would be quietly wrong: which credentials compose passes through, and whether the image that
 * runs is the image that compiled.
 */

const fileAt = (snapshot: Snapshot, path: string): string => {
  const file = compile(snapshot).files.find((entry) => entry.path === path);
  if (!file) throw new Error(`no ${path} emitted`);
  return file.content;
};

describe('the server a container runs', () => {
  it('writes the route table out rather than scanning a directory at boot', () => {
    const server = fileAt(supabaseSnapshot(), 'server.ts');
    expect(server).toContain("import route_api_notes from './api/notes'");
    expect(server).toContain("['/api/notes', route_api_notes]");
  });

  it('has nothing to route in a project with no routes', () => {
    const server = fileAt(trivialSnapshot(), 'server.ts');
    expect(server).toContain('const ROUTES = new Map<string, Handler>([');
    expect(server).not.toContain('./api/');
  });

  it('caches the hashed assets forever and the HTML never', () => {
    // The built assets carry a content hash; the HTML that names them cannot be cached, or a
    // deploy would never be seen.
    const server = fileAt(trivialSnapshot(), 'server.ts');
    expect(server).toContain('max-age=31536000, immutable');
    expect(server).toContain("'no-cache'");
  });
});

describe('the image', () => {
  const dockerfile = () => fileAt(trivialSnapshot(), 'Dockerfile');

  it('builds in one stage and runs in another', () => {
    expect(dockerfile()).toContain('FROM node:22-alpine AS build');
    expect(dockerfile()).toContain('FROM node:22-alpine AS runtime');
    // The runtime image installs production dependencies only.
    expect(dockerfile()).toContain('npm install --omit=dev');
  });

  it("runs the project's own build, so a type error stops the image", () => {
    expect(dockerfile()).toContain('RUN npm run build');
  });

  it('does not run as root', () => {
    expect(dockerfile()).toContain('USER node');
  });

  it('keeps secrets out of the image', () => {
    const ignore = fileAt(trivialSnapshot(), '.dockerignore');
    expect(ignore).toContain('.env');
    expect(ignore).toContain('!.env.example');
    expect(ignore).toContain('node_modules');
  });
});

describe('compose', () => {
  it('passes credentials by name, never by value', () => {
    const yaml = fileAt(supabaseSnapshot(), 'docker-compose.yml');
    expect(yaml).toContain('SUPABASE_URL: ${SUPABASE_URL}');
    expect(yaml).toContain('SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}');
    // Nothing that looks like a value ever lands in a file that gets committed.
    expect(yaml).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY:\s*[A-Za-z0-9]/);
  });

  it('brings a database for a project that talks to one directly', () => {
    const yaml = fileAt(postgresSnapshot(), 'docker-compose.yml');
    expect(yaml).toContain('postgres:16-alpine');
    expect(yaml).toContain('DATABASE_URL: ${DATABASE_URL}');
    // And waits for one that answers, not merely one that has started.
    expect(yaml).toContain('condition: service_healthy');
  });

  it('brings none for a project that reaches a service someone else runs', () => {
    const yaml = fileAt(supabaseSnapshot(), 'docker-compose.yml');
    expect(yaml).not.toContain('postgres:16-alpine');
    expect(yaml).not.toContain('volumes:');
  });
});
