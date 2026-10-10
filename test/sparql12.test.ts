import { describe, expect, it } from 'vitest';
import { UnsupportedQuery } from '../src/rewrite.js';
import { Harness } from './helpers.js';

// RDF 1.2: reifiers and triple terms carry whole triples, so they must not reveal hidden ones.
const DATA = `
@prefix ex: <https://example.org/> .
<https://example.org/graph/hr> {
  ex:alice a ex:Employee ; ex:department ex:Sales ;
    ex:salary 5000 ~ ex:r1 {| ex:source ex:payroll |} ;
    ex:name "Alice" ~ ex:r2 {| ex:source ex:registry |} .
  ex:bob a ex:Employee ; ex:department ex:Board ;
    ex:name "Bob" ~ ex:r3 {| ex:source ex:registry |} .
  ex:note1 ex:about <<( ex:bob ex:name "Bob" )>> .
  ex:note2 ex:about <<( ex:acme ex:says <<( ex:alice ex:name "Alice" )>> )>> .
}`;

const POLICIES = `
@prefix sg: <https://matdata.eu/ns/sparql-guard#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/> .
ex:p a sg:Policy ; sg:group "sales" ; sg:readGraph <https://example.org/graph/hr> ;
  sg:visibleIf ex:SalesOnly ; sg:hideProperties ex:NoSalary .
ex:SalesOnly sh:targetClass ex:Employee ; sh:property [ sh:path ex:department ; sh:hasValue ex:Sales ] .
ex:NoSalary sh:targetClass ex:Employee ; sh:property [ sh:path ex:salary ] .
`;

const SALES = { agent: 'urn:test:sales', groups: ['sales'] };

function harness(version: '1.1' | '1.2'): Harness {
  const h = Harness.withPolicies(POLICIES, DATA);
  h.sparqlVersion = version;
  return h;
}

describe('SPARQL 1.2', () => {
  const h = harness('1.2');

  it('only returns triple terms whose triple is visible', () => {
    expect(h.select('SELECT ?o WHERE { ?r rdf:reifies ?t BIND(OBJECT(?t) AS ?o) }', SALES, 'o')).toEqual(['Alice']);
  });

  it('checks triple term patterns in the query', () => {
    expect(h.select('SELECT ?x WHERE { ?r rdf:reifies <<( ex:alice ex:salary ?x )>> }', SALES, 'x')).toEqual([]);
    expect(h.select('SELECT ?n WHERE { ?r rdf:reifies <<( ?e ex:name ?n )>> }', SALES, 'n')).toEqual(['Alice']);
  });

  it('supports reifier and annotation syntax', () => {
    expect(h.select('SELECT ?src WHERE { ex:alice ex:name ?n {| ex:source ?src |} }', SALES, 'src'))
      .toEqual(['https://example.org/registry']);
    expect(h.select('SELECT ?src WHERE { << ex:alice ex:salary ?s >> ex:source ?src }', SALES, 'src')).toEqual([]);
  });

  it('hides triple terms about hidden resources, also as plain objects', () => {
    expect(h.select('SELECT ?t WHERE { ex:note1 ex:about ?t }', SALES, 't')).toEqual([]);
  });

  it('hides nested triple terms rather than unpacking them', () => {
    expect(h.select('SELECT ?t WHERE { ex:note2 ex:about ?t }', SALES, 't')).toEqual([]);
  });

  it('keeps answering plain SPARQL 1.1 queries', () => {
    expect(h.select('SELECT ?n WHERE { ?e ex:name ?n }', SALES, 'n')).toEqual(['Alice']);
  });

  it('refuses SPARQL 1.2 syntax in 1.1 mode', () => {
    expect(() => harness('1.1').rewrite('SELECT * WHERE { ?r rdf:reifies <<( ?s ?p ?o )>> }', SALES)).toThrow(UnsupportedQuery);
  });
});
