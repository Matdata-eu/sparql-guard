import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import oxigraph from 'oxigraph';
import { PolicySet, type Requester } from '../src/policy.js';
import { rewriteQuery, type Dataset } from '../src/rewrite.js';

export const examples = (file: string): string => fileURLToPath(new URL(`../examples/${file}`, import.meta.url));

export const PREFIXES = `
PREFIX ex: <https://example.org/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
`;

export const ALICE: Requester = { agent: 'urn:sparql-guard:user:alice', groups: ['sales'] };
export const ANONYMOUS: Requester = { agent: null, groups: [] };
export const ADMIN: Requester = { agent: 'urn:sparql-guard:user:hilde', groups: ['hr-admins'] };

/** An in-memory store with the example data, and a way to query it through a policy set. */
export class Harness {
  public readonly store = new oxigraph.Store();
  public sparqlVersion: '1.1' | '1.2' = '1.1';

  public constructor(public policies: PolicySet, data = readFileSync(examples('data.trig'), 'utf8')) {
    this.store.load(data, { format: 'application/trig' });
  }

  public static example(options: { graphSpanningChecks?: boolean } = {}): Harness {
    return new Harness(PolicySet.fromFiles([examples('policies.ttl')], options));
  }

  public static withPolicies(turtle: string, data?: string): Harness {
    return new Harness(PolicySet.fromSources([{ name: 'test.ttl', text: turtle }]), data);
  }

  public rewrite(query: string, requester: Requester, protocolDataset?: Dataset): string {
    const policy = this.policies.resolve(requester);
    if (!policy) {
      throw new Error('no policy');
    }
    return rewriteQuery(PREFIXES + query, policy, { agent: requester.agent, protocolDataset, sparqlVersion: this.sparqlVersion }).query;
  }

  /** Runs a SELECT through the policies; returns the sorted values of one variable. */
  public select(query: string, requester: Requester, variable: string): string[] {
    const rows = this.store.query(this.rewrite(query, requester)) as Map<string, { value: string }>[];
    return rows.map(r => r.get(variable)?.value ?? '').sort();
  }

  public ask(query: string, requester: Requester): boolean {
    return this.store.query(this.rewrite(query, requester)) as boolean;
  }

  public construct(query: string, requester: Requester): string[] {
    const quads = this.store.query(this.rewrite(query, requester)) as { subject: { value: string }; predicate: { value: string }; object: { value: string } }[];
    return quads.map(q => `${short(q.subject.value)} ${short(q.predicate.value)} ${short(q.object.value)}`).sort();
  }
}

export function short(iri: string): string {
  return iri.replace('https://example.org/', 'ex:');
}
