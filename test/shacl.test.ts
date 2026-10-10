import { describe, expect, it } from 'vitest';
import { PolicySet } from '../src/policy.js';
import { PolicyError } from '../src/shacl.js';
import { Harness, short } from './helpers.js';

const DATA = `
@prefix ex: <https://example.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<https://example.org/graph/g> {
  ex:a a ex:Item ; ex:level 1 ; ex:status "open" ; ex:tag ex:green ; ex:code "AB-1" .
  ex:b a ex:Item ; ex:level 5 ; ex:status "closed" ; ex:tag ex:red, ex:green ; ex:code "XY-9" .
  ex:c a ex:Item ; ex:status "open"@en ; ex:code "AB-2" .
  ex:d a ex:Other ; ex:level 9 .
}`;

const AGENT = { agent: 'urn:test:agent', groups: [] };

function visibleItems(shapeBody: string): string[] {
  const h = Harness.withPolicies(`
    @prefix sg: <https://matdata.eu/ns/sparql-guard#> .
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix ex: <https://example.org/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    ex:p a sg:Policy ; sg:agent <urn:test:agent> ; sg:readAllGraphs true ; sg:visibleIf ex:S .
    ex:S a sh:NodeShape ; sh:targetClass ex:Item ; ${shapeBody} .`, DATA);
  return h.select('SELECT DISTINCT ?s WHERE { GRAPH ?g { ?s ?p ?o } }', AGENT, 's').map(short);
}

describe('SHACL constraint translation', () => {
  it('sh:hasValue', () => {
    expect(visibleItems('sh:property [ sh:path ex:tag ; sh:hasValue ex:green ]')).toEqual(['ex:a', 'ex:b', 'ex:d']);
  });

  it('sh:in applies to every value', () => {
    expect(visibleItems('sh:property [ sh:path ex:tag ; sh:in ( ex:green ) ]')).toEqual(['ex:a', 'ex:c', 'ex:d']);
  });

  it('sh:minCount and sh:maxCount', () => {
    expect(visibleItems('sh:property [ sh:path ex:level ; sh:minCount 1 ]')).toEqual(['ex:a', 'ex:b', 'ex:d']);
    expect(visibleItems('sh:property [ sh:path ex:tag ; sh:maxCount 1 ]')).toEqual(['ex:a', 'ex:c', 'ex:d']);
    expect(visibleItems('sh:property [ sh:path ex:tag ; sh:maxCount 0 ]')).toEqual(['ex:c', 'ex:d']);
  });

  it('numeric ranges treat incomparable values as violations', () => {
    expect(visibleItems('sh:property [ sh:path ex:level ; sh:maxInclusive 3 ]')).toEqual(['ex:a', 'ex:c', 'ex:d']);
  });

  it('sh:datatype and sh:languageIn', () => {
    expect(visibleItems('sh:property [ sh:path ex:status ; sh:datatype xsd:string ]')).toEqual(['ex:a', 'ex:b', 'ex:d']);
    expect(visibleItems('sh:property [ sh:path ex:status ; sh:languageIn ( "en" ) ]')).toEqual(['ex:c', 'ex:d']);
  });

  it('sh:pattern', () => {
    expect(visibleItems('sh:property [ sh:path ex:code ; sh:pattern "^ab-" ; sh:flags "i" ]')).toEqual(['ex:a', 'ex:c', 'ex:d']);
  });

  it('sh:or, sh:not and sh:node', () => {
    expect(visibleItems(`sh:or (
      [ sh:property [ sh:path ex:status ; sh:hasValue "closed" ] ]
      [ sh:property [ sh:path ex:level ; sh:minCount 1 ; sh:maxInclusive 1 ] ]
    )`)).toEqual(['ex:a', 'ex:b', 'ex:d']);
    expect(visibleItems('sh:not [ sh:property [ sh:path ex:tag ; sh:hasValue ex:red ] ]')).toEqual(['ex:a', 'ex:c', 'ex:d']);
  });

  it('sh:targetNode, inverse paths', () => {
    const h = Harness.withPolicies(`
      @prefix sg: <https://matdata.eu/ns/sparql-guard#> .
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix ex: <https://example.org/> .
      ex:p a sg:Policy ; sg:agent sg:Anyone ; sg:readAllGraphs true ; sg:visibleIf ex:S .
      ex:S sh:targetNode ex:green ; sh:property [ sh:path [ sh:inversePath ex:tag ] ; sh:maxCount 1 ] .`, DATA);
    expect(h.select('SELECT DISTINCT ?o WHERE { GRAPH ?g { ?s ex:tag ?o } }', { agent: null, groups: [] }, 'o')).toEqual(['https://example.org/red']);
  });
});

describe('policy loading fails closed', () => {
  const load = (shape: string): PolicySet => PolicySet.fromSources([{
    name: 'p.ttl',
    text: `
      @prefix sg: <https://matdata.eu/ns/sparql-guard#> .
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix ex: <https://example.org/> .
      ex:p a sg:Policy ; sg:agent sg:Anyone ; sg:readAllGraphs true ; sg:visibleIf ex:S .
      ex:S sh:targetClass ex:Item ; ${shape} .`,
  }]);

  it('rejects constraint components it cannot translate', () => {
    expect(() => load('sh:sparql [ sh:select "SELECT $this WHERE {}" ]')).toThrow(PolicyError);
    expect(() => load('sh:closed true')).toThrow(PolicyError);
  });

  it('rejects recursive shapes', () => {
    expect(() => load('sh:node ex:S')).toThrow(PolicyError);
  });

  it('rejects policies that apply to nobody', () => {
    expect(() => PolicySet.fromSources([{
      name: 'p.ttl',
      text: '<urn:p> a <https://matdata.eu/ns/sparql-guard#Policy> .',
    }])).toThrow(PolicyError);
  });
});
