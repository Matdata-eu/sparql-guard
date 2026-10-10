import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PolicySet, type Requester } from '../src/policy.js';
import { examples, Harness } from './helpers.js';

// The roles of the docker compose playground (examples/railway).
const h = new Harness(
  PolicySet.fromFiles([examples('railway/policies.ttl')]),
  readFileSync(examples('railway/data.trig'), 'utf8'),
);

const PREFIXES = 'PREFIX rv: <https://example.org/rail/vocab#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ';
const user = (name: string, ...groups: string[]): Requester => ({ agent: `urn:sparql-guard:user:${name}`, groups });
const select = (query: string, who: Requester, v: string): string[] => h.select(PREFIXES + query, who, v);

const STAFF = 'SELECT ?n WHERE { ?p a rv:Staff ; rdfs:label ?n }';
const ORDERS = 'SELECT ?l WHERE { ?o a rv:WorkOrder ; rdfs:label ?l }';

describe('railway playground roles', () => {
  it('anonymous users read the network graph only', () => {
    expect(select('SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }', { agent: null, groups: [] }, 'g'))
      .toEqual(['https://example.org/rail/graph/network']);
  });

  it('a railway undertaking only sees its own train paths', () => {
    expect(select('SELECT ?t WHERE { ?p a rv:TrainPath ; rv:trainNumber ?t }', user('acme-dispatcher', 'operator-acme'), 't'))
      .toEqual(['IC 2131', 'IC 3514']);
  });

  it('maintenance teams see their region, their own record, and no salary scales', () => {
    const jan = user('jan', 'maintenance-north');
    expect(select(ORDERS, jan, 'l')).toEqual(['Lubricate switch 7', 'Replace lamp unit AX-214']);
    expect(select('SELECT (SUM(?c) AS ?t) WHERE { ?o rv:costEstimateEur ?c }', jan, 't')).toEqual(['4250']);
    expect(select(STAFF, jan, 'n')).toEqual(['Jan Peeters', 'Pieter Claes']);
    expect(select('SELECT ?s WHERE { ?p rv:salaryScale ?s }', jan, 's')).toEqual([]);

    const els = user('els', 'maintenance-south');
    expect(select(STAFF, els, 'n')).toEqual(['Els Dubois', 'Sofie Maes']);
    // Els working with the north team still sees her own record.
    expect(select(STAFF, user('els', 'maintenance-north'), 'n')).toEqual(['Els Dubois', 'Jan Peeters', 'Pieter Claes']);
  });

  it('safety analysts see incidents without personal data or access codes', () => {
    const analyst = user('investigator', 'safety');
    expect(select('SELECT ?i WHERE { ?i a rv:Incident }', analyst, 'i')).toHaveLength(3);
    expect(select('SELECT ?d WHERE { ?i rv:involvedDriver ?d }', analyst, 'd')).toEqual([]);
    expect(select('SELECT ?c WHERE { ?x rv:cabinetAccessCode ?c }', analyst, 'c')).toEqual([]);
    expect(h.construct('DESCRIBE <https://example.org/rail/data/lc-50-12>', analyst).some(t => t.includes('AccessCode'))).toBe(false);
  });

  it('administrators see everything', () => {
    expect(select('SELECT ?d WHERE { GRAPH ?g { ?i rv:involvedDriver ?d } }', user('admin', 'admin'), 'd')).toHaveLength(2);
  });
});
