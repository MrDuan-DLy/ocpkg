import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { REGISTRY_PATH } from './paths.mjs';

const SCHEMA_VERSION = 1;

export async function readRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    return { version: SCHEMA_VERSION, packages: {} };
  }
  const raw = await readFile(REGISTRY_PATH, 'utf8');
  return JSON.parse(raw);
}

export async function writeRegistry(registry) {
  await mkdir(dirname(REGISTRY_PATH), { recursive: true });
  await writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
}

export async function updatePackage(name, updates) {
  const registry = await readRegistry();
  if (!registry.packages[name]) {
    throw new Error(`Package "${name}" not found in registry`);
  }
  registry.packages[name] = { ...registry.packages[name], ...updates };
  await writeRegistry(registry);
  return registry;
}

export async function getPackage(name) {
  const registry = await readRegistry();
  return registry.packages[name] || null;
}
