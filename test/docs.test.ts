import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PolicySet } from '../src/policy.js';
import { examples, Harness, short } from './helpers.js';

const DOCS = fileURLToPath(new URL('../docs', import.meta.url));

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name.startsWith('.') || name === 'node_modules') {
      return [];
    }
    return statSync(path).isDirectory() ? markdownFiles(path) : name.endsWith('.md') ? [path] : [];
  });
}

/** Complete policy examples: Turtle blocks that declare the sg: prefix and a policy. */
const policyBlocks = markdownFiles(DOCS).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/```turtle\r?\n([\s\S]*?)```/gu)]
    .map(m => m[1])
    .filter(text => text.includes('@prefix sg:') && text.includes('a sg:Policy'))
    .map((text, i) => ({ name: `${file.slice(DOCS.length + 1)} #${i + 1}`, text })));

describe('policy examples in the documentation', () => {
  it('finds examples', () => {
    expect(policyBlocks.length).toBeGreaterThanOrEqual(10);
  });

  it.each(policyBlocks)('$name loads', ({ name, text }) => {
    expect(() => PolicySet.fromSources([{ name: `${name}.ttl`, text }])).not.toThrow();
  });
});

describe('claims made in the documentation', () => {
  const rail = new Harness(
    PolicySet.fromFiles([examples('railway/policies.ttl')]),
    readFileSync(examples('railway/data.trig'), 'utf8'),
  );
  const P = 'PREFIX rv: <https://example.org/rail/vocab#> PREFIX rd: <https://example.org/rail/data/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ';
  const user = (name: string, group: string) => ({ agent: `urn:sparql-guard:user:${name}`, groups: [group] });
  const budget = (who: ReturnType<typeof user>) =>
    rail.select(`${P} SELECT (SUM(?c) AS ?t) WHERE { ?o a rv:WorkOrder ; rv:costEstimateEur ?c }`, who, 't');

  it('playground: the maintenance budget depends on the role', () => {
    expect(budget(user('jan', 'maintenance-north'))).toEqual(['4250']);
    expect(budget(user('els', 'maintenance-south'))).toEqual(['61900']);
    expect(budget(user('admin', 'admin'))).toEqual(['66150']);
  });

  it('playground: hidden work orders and DESCRIBE', () => {
    const jan = user('jan', 'maintenance-north');
    expect(rail.select(`${P} SELECT ?n WHERE { rd:wo-2026-0412 rv:assignedTo/rdfs:label ?n }`, jan, 'n')).toEqual(['Jan Peeters']);
    expect(rail.select(`${P} SELECT ?n WHERE { rd:wo-2026-0425 rdfs:label ?n }`, jan, 'n')).toEqual([]);
    expect(rail.construct(`${P} DESCRIBE rd:lc-50-12`, user('els', 'maintenance-south'))).toEqual([]);
  });

  it('recipes: region of the user\'s team', () => {
    const block = policyBlocks.find(b => b.text.includes('ex:AssetsInMyRegion'))!;
    // The railway data keeps rdfs:subClassOf in the network graph, which must be readable for
    // sh:targetClass rv:Asset to match signals and switches (see "Writing policies").
    const text = block.text.replaceAll('<https://example.org/>', '<https://example.org/rail/vocab#>')
      .replace('sg:readGraph ', 'sg:readGraph <https://example.org/graph/network>, ');
    const h = new Harness(PolicySet.fromSources([{ name: 'r.ttl', text }]), readFileSync(examples('railway/data.trig'), 'utf8')
      // The recipe's graphs and region links, mapped onto the railway data.
      .replaceAll('<https://example.org/rail/graph/', '<https://example.org/graph/'));
    const assets = h.select(`${P} SELECT ?a WHERE { GRAPH ?g { ?a rv:condition ?c } }`, user('jan', 'field-staff'), 'a').map(short);
    expect(assets).toEqual(['ex:rail/data/lc-50-12', 'ex:rail/data/sig-25-101', 'ex:rail/data/sig-25-214', 'ex:rail/data/sw-mechelen-7']);
  });
});
