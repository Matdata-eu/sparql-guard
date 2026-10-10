import { describe, expect, it } from 'vitest';
import { AccessDenied, UnsupportedQuery } from '../src/rewrite.js';
import { ADMIN, ALICE, ANONYMOUS, Harness, short } from './helpers.js';

const h = Harness.example();
const names = (rows: string[]): string[] => rows.map(short);

describe('graph-level policies', () => {
  it('only exposes the granted graphs as the default graph', () => {
    expect(names(h.select('SELECT DISTINCT ?s WHERE { ?s ?p ?o }', ANONYMOUS, 's')))
      .toEqual(['ex:Manager', 'ex:acme']);
  });

  it('only lists granted named graphs', () => {
    expect(h.select('SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }', ANONYMOUS, 'g'))
      .toEqual(['https://example.org/graph/public']);
  });

  it('ignores FROM clauses naming graphs that are not granted', () => {
    expect(h.select('SELECT ?s FROM <https://example.org/graph/hr> WHERE { ?s ?p ?o }', ANONYMOUS, 's')).toEqual([]);
    expect(h.select('SELECT ?s FROM NAMED <https://example.org/graph/payroll> WHERE { GRAPH ?g { ?s ?p ?o } }', ANONYMOUS, 's')).toEqual([]);
  });

  it('ignores protocol dataset parameters naming graphs that are not granted', () => {
    const query = h.rewrite('SELECT * WHERE { ?s ?p ?o }', ANONYMOUS, { default: ['https://example.org/graph/hr'], named: [] });
    expect(h.store.query(query)).toEqual([]);
  });

  it('keeps FROM semantics within the granted graphs', () => {
    expect(names(h.select('SELECT DISTINCT ?s FROM <https://example.org/graph/public> WHERE { ?s a ?c }', ANONYMOUS, 's')))
      .toEqual(['ex:acme']);
  });

  it('gives administrators everything', () => {
    expect(names(h.select('SELECT ?r WHERE { GRAPH ?g { ?r a ex:PayrollRun } }', ADMIN, 'r'))).toEqual(['ex:run-2026-09']);
  });
});

describe('row-level policies (SHACL visibility)', () => {
  it('hides employees that do not conform to the visibility shape', () => {
    expect(names(h.select('SELECT ?e WHERE { ?e a ex:Employee }', ALICE, 'e')))
      .toEqual(['ex:alice', 'ex:carol']);
  });

  it('treats sh:targetClass as including subclasses', () => {
    // ex:bob is an ex:Manager, a subclass of ex:Employee, and is not in Sales.
    expect(h.select('SELECT ?n WHERE { ?e ex:name ?n }', ALICE, 'n')).toEqual(['ACME', 'Alice', 'Carol']);
  });

  it('hides references to hidden resources', () => {
    expect(h.select('SELECT ?m WHERE { ex:alice ex:reportsTo ?m }', ALICE, 'm')).toEqual([]);
    expect(h.ask('ASK { ?x ex:reportsTo ex:bob }', ALICE)).toBe(false);
  });

  it('cannot be bypassed through FILTER EXISTS', () => {
    expect(h.select('SELECT ?c WHERE { ?c a ex:Company FILTER EXISTS { ?b ex:department ex:Board } }', ALICE, 'c')).toEqual([]);
  });

  it('cannot be bypassed through MINUS or aggregates', () => {
    expect(h.select('SELECT (COUNT(?e) AS ?n) WHERE { ?e ex:worksFor ex:acme }', ALICE, 'n')).toEqual(['2']);
  });

  it('cannot be bypassed through sub-queries', () => {
    expect(h.select('SELECT ?n WHERE { { SELECT (MAX(?s) AS ?n) WHERE { ?e ?p ?s FILTER(isNumeric(?s)) } } }', ALICE, 'n'))
      .toEqual(['']);
  });

  it('checks the intermediate nodes of sequence paths', () => {
    expect(h.select('SELECT ?n WHERE { ex:alice ex:reportsTo/ex:name ?n }', ALICE, 'n')).toEqual([]);
  });

  it('cannot be bypassed by picking the graph that lacks the type triple', () => {
    const data = `
      @prefix ex: <https://example.org/> .
      <https://example.org/graph/hr> { ex:bob a ex:Employee ; ex:department ex:Board . }
      <https://example.org/graph/public> { ex:bob ex:name "Bob" . }`;
    const guarded = new Harness(h.policies, data);
    expect(guarded.select('SELECT ?n WHERE { GRAPH <https://example.org/graph/public> { ?e ex:name ?n } }', ALICE, 'n')).toEqual([]);
    expect(guarded.select('SELECT ?n FROM <https://example.org/graph/public> WHERE { ?e ex:name ?n }', ALICE, 'n')).toEqual([]);
  });

  it('only shows documents owned by the requesting agent', () => {
    expect(names(h.select('SELECT ?d WHERE { ?d a ex:Document }', ALICE, 'd'))).toEqual(['ex:review-alice']);
    const carol = { agent: 'urn:sparql-guard:user:carol', groups: ['sales'] };
    expect(names(h.select('SELECT ?d WHERE { ?d a ex:Document }', carol, 'd'))).toEqual(['ex:review-carol']);
  });

  it('respects the user\'s FROM NAMED narrowing under row-level policies', () => {
    expect(h.select('SELECT DISTINCT ?g FROM NAMED <https://example.org/graph/public> WHERE { GRAPH ?g { ?s ?p ?o } }', ALICE, 'g'))
      .toEqual(['https://example.org/graph/public']);
    expect(h.select('SELECT ?s FROM NAMED <https://example.org/graph/public> WHERE { GRAPH <https://example.org/graph/hr> { ?s ?p ?o } }', ALICE, 's'))
      .toEqual([]);
  });
});

describe('hidden properties', () => {
  it('hides a property given as a constant', () => {
    expect(h.select('SELECT ?s WHERE { ?e ex:salary ?s }', ALICE, 's')).toEqual([]);
  });

  it('hides a property matched through a variable predicate', () => {
    const predicates = h.select('SELECT DISTINCT ?p WHERE { ex:alice ?p ?o }', ALICE, 'p').map(short);
    expect(predicates).not.toContain('ex:salary');
    expect(predicates).toContain('ex:name');
  });

  it('does not leak through DESCRIBE', () => {
    const triples = h.construct('DESCRIBE ex:alice', ALICE);
    expect(triples).toContain('ex:alice ex:name Alice');
    expect(triples.some(t => t.includes('salary'))).toBe(false);
    expect(triples.some(t => t.includes('reportsTo'))).toBe(false);
  });

  it('does not leak through CONSTRUCT', () => {
    expect(h.construct('CONSTRUCT WHERE { ?s ?p ?o }', ALICE).some(t => t.includes('salary') || t.includes('ex:bob'))).toBe(false);
  });

  it('refuses property paths over a hidden property', () => {
    expect(() => h.rewrite('SELECT * WHERE { ?e (ex:salary|ex:name) ?v }', ALICE)).toThrow(AccessDenied);
  });

  it('refuses negated property sets when properties are hidden', () => {
    expect(() => h.rewrite('SELECT * WHERE { ?e !ex:name ?v }', ALICE)).toThrow(UnsupportedQuery);
  });
});

describe('queries that could escape the rewrite', () => {
  it('refuses SERVICE', () => {
    expect(() => h.rewrite('SELECT * WHERE { SERVICE <http://elsewhere/sparql> { ?s ?p ?o } }', ALICE)).toThrow(AccessDenied);
  });

  it('refuses updates', () => {
    expect(() => h.rewrite('DELETE WHERE { ?s ?p ?o }', ALICE)).toThrow(AccessDenied);
  });

  it('refuses reserved variable names', () => {
    expect(() => h.rewrite('SELECT * WHERE { ?__sg_this ?p ?o }', ALICE)).toThrow(UnsupportedQuery);
  });

  it('keeps generated path variables out of reach of user variables', () => {
    // Traqula names sequence path variables ?var0; a user variable of that name must not interfere.
    expect(h.select('SELECT ?var0 WHERE { ?var0 a ex:Employee }', ALICE, 'var0').map(short)).toEqual(['ex:alice', 'ex:carol']);
  });

  it('refuses transitive paths under row-level policies', () => {
    expect(() => h.rewrite('SELECT * WHERE { ?a ex:reportsTo+ ?b }', ALICE)).toThrow(UnsupportedQuery);
  });

  it('allows transitive paths when only graph-level policies apply', () => {
    expect(names(h.select('SELECT ?c WHERE { ex:Manager rdfs:subClassOf* ?c }', ANONYMOUS, 'c')))
      .toEqual(['ex:Employee', 'ex:Manager']);
  });
});

describe('graph-spanning checks can be switched off', () => {
  it('still filters rows when checks look at the active graph only', () => {
    const local = Harness.example({ graphSpanningChecks: false });
    expect(names(local.select('SELECT ?e WHERE { ?e a ex:Employee }', ALICE, 'e'))).toEqual(['ex:alice', 'ex:carol']);
  });
});
