import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve('src');
const layers = ['domain', 'application', 'infrastructure', 'presentation'] as const;
type Layer = typeof layers[number];
// Dependencies point inward only: presentation/infrastructure -> application -> domain.
const allowedLayers: Record<Layer, Layer[]> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  presentation: ['domain', 'application', 'presentation'],
};
const httpPackages = ['express', 'zod', 'express-rate-limit', 'helmet', 'cors', 'cookie-parser', 'pino', 'pino-http'];
const generatedDir = join('src', 'generated');
const configDir = join('src', 'config');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (path.includes(generatedDir)) return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}
const layerOf = (path: string): Layer | undefined => layers.find(layer => relative(root, path).split(sep).includes(layer));
const imports = (source: string) => [...source.matchAll(/(?:import|export)[^'"]*?from\s+'([^']+)'|import\s+'([^']+)'/g)].map(match => match[1] ?? match[2]!);

describe('clean architecture dependency rule', () => {
  const files = walk(root).filter(file => layerOf(file));

  it('puts every feature file in a layer folder', () => {
    const loose = walk(join(root, 'features')).filter(file => !layerOf(file)).map(file => relative(root, file));
    expect(loose).toEqual([]);
  });

  it('only depends inward', () => {
    const violations: string[] = [];
    for (const file of files) {
      const layer = layerOf(file)!;
      const where = relative(root, file);
      for (const specifier of imports(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('.')) {
          const target = normalize(resolve(dirname(file), specifier));
          if (target.includes(generatedDir)) { if (layer !== 'infrastructure') violations.push(`${where} -> ${specifier}`); continue; }
          // Environment settings are injected configuration: adapters and controllers may read them, the core may not.
          if (target.includes(configDir)) { if (layer === 'domain' || layer === 'application') violations.push(`${where} -> ${specifier}`); continue; }
          const targetLayer = layerOf(target);
          if (!targetLayer || !allowedLayers[layer].includes(targetLayer)) violations.push(`${where} -> ${specifier}`);
          continue;
        }
        const bare = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
        if (layer === 'domain' || layer === 'application') violations.push(`${where} -> ${specifier}`);
        if (layer === 'presentation' && !httpPackages.includes(bare) && !specifier.startsWith('node:')) violations.push(`${where} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
