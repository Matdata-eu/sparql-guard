/**
 * Loads access policies (Turtle/TriG with SHACL shapes) and resolves the effective policy for
 * a requesting agent.
 */
import { readFileSync } from 'node:fs';
import { Parser, Store } from 'n3';
import type { Term } from 'n3';
import { parseExpression, spanGraphs, type Op } from './algebra.js';
import { label, PolicyError, ShaclCompiler } from './shacl.js';
import { rdf, sg } from './vocab.js';

/** Hides resources: a resource that is a target of the shape but does not conform is invisible. */
export interface VisibilityRule {
  source: string;
  /** Expression over `?__sg_this` (and `?__sg_agent`): true when the resource is visible. */
  expression: Op;
}

/** Hides properties: triples with one of these predicates are invisible on target subjects. */
export interface HiddenPropertyRule {
  source: string;
  predicates: string[];
  /** Expression over `?__sg_this`: true when the subject is a target. `null` means every subject. */
  isTarget: Op | null;
}

export interface Policy {
  id: string;
  agents: string[];
  groups: string[];
  graphs: 'all' | string[];
  visibility: VisibilityRule[];
  hiddenProperties: HiddenPropertyRule[];
  hideReferences: boolean;
  allowTransitivePaths: boolean;
}

/** What a single request is allowed to see, merged from every policy that applies to it. */
export interface EffectivePolicy {
  policies: string[];
  graphs: 'all' | string[];
  visibility: VisibilityRule[];
  hiddenProperties: HiddenPropertyRule[];
  hideReferences: boolean;
  allowTransitivePaths: boolean;
}

export interface Requester {
  /** Agent IRI, or `null` when the request is anonymous. */
  agent: string | null;
  groups: string[];
}

export interface LoadOptions {
  /** Evaluate policy checks against every graph of the dataset (default) or only the active graph. */
  graphSpanningChecks?: boolean;
}

export class PolicySet {
  public constructor(public readonly policies: Policy[]) {}

  public static fromFiles(files: string[], options: LoadOptions = {}): PolicySet {
    return PolicySet.fromSources(files.map(f => ({ name: f, text: readFileSync(f, 'utf8') })), options);
  }

  public static fromSources(sources: { name: string; text: string }[], options: LoadOptions = {}): PolicySet {
    const store = new Store();
    for (const source of sources) {
      try {
        store.addQuads(new Parser({ format: source.name.endsWith('.trig') ? 'TriG' : 'Turtle' }).parse(source.text));
      } catch (error) {
        throw new PolicyError(`Cannot parse ${source.name}: ${(error as Error).message}`);
      }
    }
    return new PolicySet(readPolicies(store, options.graphSpanningChecks ?? true));
  }

  /** Merges every policy that applies to the requester, or returns `null` when none does. */
  public resolve(requester: Requester): EffectivePolicy | null {
    const matching = this.policies.filter(p => applies(p, requester));
    if (matching.length === 0) {
      return null;
    }
    const restricted = matching.filter(p => p.visibility.length > 0 || p.hiddenProperties.length > 0);
    const graphs = matching.some(p => p.graphs === 'all') ?
      'all' :
      [...new Set(matching.flatMap(p => p.graphs as string[]))];
    // Grants (graphs) are added up; restrictions from every applicable policy all apply.
    return {
      policies: matching.map(p => p.id),
      graphs,
      visibility: matching.flatMap(p => p.visibility),
      hiddenProperties: matching.flatMap(p => p.hiddenProperties),
      hideReferences: restricted.some(p => p.hideReferences),
      allowTransitivePaths: restricted.every(p => p.allowTransitivePaths),
    };
  }
}

function applies(policy: Policy, { agent, groups }: Requester): boolean {
  return policy.agents.includes(sg.Anyone) ||
    (agent !== null && policy.agents.includes(sg.AuthenticatedAgent)) ||
    (agent !== null && policy.agents.includes(agent)) ||
    policy.groups.some(g => groups.includes(g));
}

function readPolicies(store: Store, graphSpanningChecks: boolean): Policy[] {
  const compiler = new ShaclCompiler(store);
  const prepare = (expression: string): Op => {
    const op = parseExpression(expression);
    return graphSpanningChecks ? spanGraphs(op) : op;
  };
  const policies: Policy[] = [];
  for (const node of store.getSubjects(rdf.type, sg.Policy, null)) {
    const id = label(node);
    const iris = (p: string): string[] => store.getObjects(node, p, null).map((o) => {
      if (o.termType !== 'NamedNode') {
        throw new PolicyError(`${p} on policy ${id} must be an IRI`);
      }
      return o.value;
    });
    const flag = (p: string, fallback: boolean): boolean => {
      const values = store.getObjects(node, p, null);
      return values.length === 0 ? fallback : values.every(v => v.value === 'true');
    };

    const agents = iris(sg.agent);
    const groups = store.getObjects(node, sg.group, null).map(g => g.value);
    if (agents.length === 0 && groups.length === 0) {
      throw new PolicyError(`Policy ${id} applies to nobody: add sg:agent or sg:group`);
    }
    const readGraphs = iris(sg.readGraph);
    const graphs = flag(sg.readAllGraphs, false) ? 'all' : readGraphs;

    const visibility = store.getObjects(node, sg.visibleIf, null).map((shape: Term) => ({
      source: label(shape),
      expression: prepare(compiler.visibility(shape)),
    }));
    const hiddenProperties = store.getObjects(node, sg.hideProperties, null).map((shape: Term) => {
      const { isTarget, predicates } = compiler.hiddenProperties(shape);
      return { source: label(shape), predicates, isTarget: isTarget === null ? null : prepare(isTarget) };
    });

    policies.push({
      id,
      agents,
      groups,
      graphs,
      visibility,
      hiddenProperties,
      hideReferences: flag(sg.hideReferences, true),
      allowTransitivePaths: flag(sg.allowTransitivePaths, false),
    });
  }
  return policies;
}
