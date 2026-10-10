/**
 * The query rewriter: turns a user's SPARQL query into one that can only see what the
 * effective policy allows, so it can be sent to any SPARQL 1.1 store.
 *
 * Semantics: the rewritten query evaluates the user's query over a *view* of the store that
 *   1. contains only the graphs the agent may read (dataset restriction), and
 *   2. contains only the triples whose subject (and, by default, object) is a visible resource
 *      and whose predicate is not hidden for that subject (row-level restriction).
 */
import type * as RDF from '@rdfjs/types';
import {
  and, astToAlgebra, factory, FALSE, filter, generate, mapOps, operator, parseAst, substitute, termExpr,
  variable, visit, type Op, type SparqlVersion,
} from './algebra.js';
import type { EffectivePolicy, HiddenPropertyRule } from './policy.js';
import { ANONYMOUS_AGENT, EMPTY_GRAPH, RESERVED_VAR_PREFIX } from './vocab.js';

/** The request is understood but not allowed (HTTP 403). */
export class AccessDenied extends Error {
  public readonly status = 403;
  public constructor(message: string) {
    super(message);
    this.name = 'AccessDenied';
  }
}

/** The request cannot be safely rewritten (HTTP 400). */
export class UnsupportedQuery extends Error {
  public readonly status = 400;
  public constructor(message: string) {
    super(message);
    this.name = 'UnsupportedQuery';
  }
}

export interface Dataset {
  default: string[];
  named: string[];
}

export interface RewriteOptions {
  /** Agent IRI substituted for `sg:requestingAgent`; `null` for anonymous requests. */
  agent: string | null;
  /** `default-graph-uri` / `named-graph-uri` from the SPARQL protocol; they override FROM clauses. */
  protocolDataset?: Dataset;
  /**
   * SPARQL version to accept and generate. With `1.2`, triple terms (RDF 1.2 / RDF-star) are
   * checked too, using `isTRIPLE`, `SUBJECT`, `PREDICATE` and `OBJECT`. Default `1.1`.
   */
  sparqlVersion?: SparqlVersion;
  /**
   * Return an indented query for people to read, instead of a single line. Large queries are
   * always returned on one line, since indenting them is slow.
   */
  pretty?: boolean;
}

export interface RewriteResult {
  query: string;
  form: 'select' | 'ask' | 'construct' | 'describe';
}

const QUERY_FORMS: Record<string, RewriteResult['form']> = {
  project: 'select', distinct: 'select', reduced: 'select', slice: 'select', orderby: 'select',
  ask: 'ask', construct: 'construct', describe: 'describe',
};

/** Beyond this many characters, indenting the generated query costs seconds of CPU. */
const PRETTY_LIMIT = 20_000;

const UPDATE_TYPES = new Set([
  'compositeupdate', 'deleteinsert', 'load', 'clear', 'create', 'drop', 'add', 'move', 'copy',
]);

export function rewriteQuery(query: string, policy: EffectivePolicy, options: RewriteOptions): RewriteResult {
  const version = options.sparqlVersion ?? '1.1';
  let ast: Op;
  try {
    ast = parseAst(query, version);
  } catch (error) {
    throw new UnsupportedQuery(`Cannot parse query: ${(error as Error).message}`);
  }
  if (ast.type === 'update') {
    throw new AccessDenied('SPARQL Update is not allowed through this endpoint');
  }
  let op: Op;
  try {
    op = astToAlgebra(ast, version);
  } catch (error) {
    throw new UnsupportedQuery(`Cannot translate query: ${(error as Error).message}`);
  }
  validate(op);

  // Peel off the dataset clause; we put back our own.
  let requested: Dataset | undefined;
  if (op.type === 'from') {
    requested = { default: op.default.map(term), named: op.named.map(term) };
    op = op.input;
  }
  if (options.protocolDataset &&
    (options.protocolDataset.default.length > 0 || options.protocolDataset.named.length > 0)) {
    requested = options.protocolDataset;
  }
  const form = QUERY_FORMS[op.type];
  if (!form) {
    throw new UnsupportedQuery(`Unsupported query form: ${op.type}`);
  }
  if (op.type === 'describe') {
    op = describeAsConstruct(op);
  }

  const rowLevel = policy.visibility.length > 0 || policy.hiddenProperties.length > 0;
  let dataset: Dataset | undefined = requested;
  if (policy.graphs === 'all') {
    if (rowLevel && requested) {
      // We cannot list "all graphs" in FROM NAMED, so the policy checks could not see every
      // graph. Refuse rather than risk checking against a narrowed dataset.
      throw new UnsupportedQuery('FROM / FROM NAMED are not supported under row-level policies; use GRAPH instead');
    }
  } else {
    const allowed = policy.graphs;
    const restricted = restrictDataset(requested, allowed);
    if (rowLevel) {
      // The checks must see every readable graph, so FROM NAMED always lists all of them;
      // a narrower FROM NAMED from the user is enforced on the user's own GRAPH patterns.
      if (requested) {
        op = narrowGraphs(op, restricted.named);
      }
      dataset = { default: restricted.default, named: allowed };
    } else {
      dataset = restricted;
    }
  }

  if (rowLevel) {
    op = new RowLevel(policy, options.agent, version === '1.2').apply(op);
  }
  if (dataset) {
    op = {
      type: 'from',
      input: op,
      default: nonEmpty(dataset.default).map(g => factory.namedNode(g)),
      named: nonEmpty(dataset.named).map(g => factory.namedNode(g)),
    };
  }
  const compact = generate(op, version);
  if (options.pretty && compact.length <= PRETTY_LIMIT) {
    return { query: generate(op, version, true), form };
  }
  return { query: compact, form };
}

function term(t: RDF.Term): string {
  return t.value;
}

/** An empty list in FROM would mean "the store's default dataset", so use an empty graph instead. */
function nonEmpty(graphs: string[]): string[] {
  return graphs.length > 0 ? graphs : [EMPTY_GRAPH];
}

/** Applies the SPARQL dataset rules to the user's request, intersected with the allowed graphs. */
function restrictDataset(requested: Dataset | undefined, allowed: string[]): Dataset {
  if (!requested) {
    // No dataset clause: the default graph is the union of everything the agent may read.
    return { default: allowed, named: allowed };
  }
  const allowedSet = new Set(allowed);
  // Per SPARQL 1.1 §13.2: FROM without FROM NAMED gives no named graphs, and vice versa.
  return {
    default: requested.default.filter(g => allowedSet.has(g)),
    named: requested.named.filter(g => allowedSet.has(g)),
  };
}

/** Rejects anything that could bypass the rewrite. */
function validate(op: Op): void {
  visit(op, (node) => {
    if (node.termType === 'Variable' && node.value.startsWith(RESERVED_VAR_PREFIX)) {
      throw new UnsupportedQuery(`Variables starting with ?${RESERVED_VAR_PREFIX} are reserved`);
    }
    if (UPDATE_TYPES.has(node.type)) {
      throw new AccessDenied('SPARQL Update is not allowed through this endpoint');
    }
    if (node.type === 'service') {
      throw new AccessDenied('SERVICE (federated queries) is not allowed through this endpoint');
    }
  });
}

/**
 * DESCRIBE output is store-specific and usually includes every triple about a resource, so it
 * would bypass the row-level filters. Rewrite it into an explicit CONSTRUCT of the outgoing triples.
 */
function describeAsConstruct(op: Op): Op {
  const d = variable(`${RESERVED_VAR_PREFIX}d`);
  const p = variable(`${RESERVED_VAR_PREFIX}p`);
  const o = variable(`${RESERVED_VAR_PREFIX}o`);
  const resources = op.terms.map((t: RDF.Term) => ({
    type: 'extend', input: op.input, variable: d, expression: termExpr(t),
  }));
  const pattern = {
    type: 'pattern', termType: 'Quad', value: '', subject: d, predicate: p, object: o, graph: factory.defaultGraph(),
  };
  return {
    type: 'construct',
    template: [pattern],
    input: {
      type: 'join',
      input: [
        resources.length === 1 ? resources[0] : { type: 'union', input: resources },
        { type: 'bgp', patterns: [pattern] },
      ],
    },
  };
}

/** Makes the user's GRAPH patterns respect their own (allowed) FROM NAMED list. */
function narrowGraphs(op: Op, named: string[]): Op {
  const allowed = named.map(g => termExpr(factory.namedNode(g)));
  return mapOps(op, (node) => {
    if (node.type !== 'graph') {
      return node;
    }
    if (node.name.termType === 'NamedNode') {
      return named.includes(node.name.value) ? node : filter(FALSE, node);
    }
    return filter(operator('in', [termExpr(node.name), ...allowed]), node);
  });
}

/** Injects the row-level checks (visibility and hidden properties) into every pattern. */
class RowLevel {
  private readonly agent: RDF.NamedNode;
  private counter = 0;

  /**
   * @param tripleTerms check triple terms (SPARQL 1.2): a triple term carries a whole triple, so
   *   it is only visible when that triple would be visible as well.
   */
  public constructor(
    private readonly policy: EffectivePolicy,
    agent: string | null,
    private readonly tripleTerms: boolean,
  ) {
    this.agent = factory.namedNode(agent ?? ANONYMOUS_AGENT);
  }

  public apply(op: Op): Op {
    return mapOps(op, (node) => {
      if (node.type === 'bgp' && node.patterns.length > 0) {
        const checks = new Checks();
        for (const pattern of node.patterns) {
          this.triple(pattern.subject, pattern.predicate, pattern.object, checks, 0);
        }
        return checks.wrap(node);
      }
      if (node.type === 'path') {
        checkPath(node.predicate, this.policy);
        const checks = new Checks();
        this.node(node.subject, checks, 0, false);
        this.node(node.object, checks, 0, true);
        return checks.wrap(node);
      }
      return node;
    });
  }

  /** Conditions under which the triple (s, p, o) is part of the view. */
  private triple(s: RDF.Term, p: RDF.Term, o: RDF.Term, checks: Checks, depth: number): void {
    this.node(s, checks, depth, false);
    if (o.termType === 'Quad' || this.policy.hideReferences) {
      this.node(o, checks, depth, true);
    } else {
      this.tripleTerm(o, checks, depth);
    }
    for (const rule of this.policy.hiddenProperties) {
      checks.add(this.hiddenProperty(rule, s, p));
    }
  }

  /** Checks for a term in subject or object position. */
  private node(t: RDF.Term, checks: Checks, depth: number, mayBeLiteral: boolean): void {
    if (t.termType === 'Quad') {
      // A triple term pattern in the query, e.g. `?r rdf:reifies <<( ?s ex:salary ?o )>>`:
      // its components must form a visible triple.
      const q = t as unknown as RDF.Quad;
      this.triple(q.subject, q.predicate, q.object, checks, depth);
      return;
    }
    checks.resource(t, this.visible, mayBeLiteral);
    this.tripleTerm(t, checks, depth);
  }

  /**
   * A variable may be bound to a triple term at runtime. Its subject, predicate and object are
   * unpacked with SUBJECT/PREDICATE/OBJECT and checked like any triple. Nested triple terms are
   * hidden rather than unpacked further.
   */
  private tripleTerm(t: RDF.Term, checks: Checks, depth: number): void {
    if (!this.tripleTerms || t.termType !== 'Variable') {
      return;
    }
    const isTriple = operator('istriple', [termExpr(t)]);
    if (depth > 0) {
      checks.addOnce(`triple:${t.value}`, operator('!', [isTriple]));
      return;
    }
    const n = this.counter++;
    const [ts, tp, to] = ['s', 'p', 'o'].map(c => variable(`${RESERVED_VAR_PREFIX}t${c}${n}`));
    const inner = new Checks();
    this.triple(ts, tp, to, inner, depth + 1);
    let unpacked: Op = { type: 'bgp', patterns: [] };
    for (const [v, fn] of [[ts, 'subject'], [tp, 'predicate'], [to, 'object']] as const) {
      unpacked = { type: 'extend', input: unpacked, variable: v, expression: operator(fn, [termExpr(t)]) };
    }
    const exists = { type: 'expression', subType: 'existence', not: false, input: inner.wrap(unpacked) };
    checks.addOnce(`triple:${t.value}`, operator('||', [operator('!', [isTriple]), exists]));
  }

  private readonly visible = (t: RDF.Term): Op[] => this.policy.visibility.map(rule => this.instantiate(rule.expression, t));

  private instantiate(template: Op, t: RDF.Term): Op {
    return substitute(template, { [`${RESERVED_VAR_PREFIX}this`]: t, [`${RESERVED_VAR_PREFIX}agent`]: this.agent });
  }

  private hiddenProperty(rule: HiddenPropertyRule, subject: RDF.Term, predicate: RDF.Term): Op | null {
    if (subject.termType === 'Quad' && rule.isTarget !== null) {
      // A triple term is never an instance of a target class.
      return null;
    }
    const notTarget = (): Op => operator('!', [this.instantiate(rule.isTarget, subject)]);
    if (predicate.termType === 'NamedNode') {
      if (!rule.predicates.includes(predicate.value)) {
        return null;
      }
      return rule.isTarget === null ? FALSE : notTarget();
    }
    const notHidden = operator('notin', [termExpr(predicate), ...rule.predicates.map(p => termExpr(factory.namedNode(p)))]);
    return rule.isTarget === null ? notHidden : operator('||', [notHidden, notTarget()]);
  }
}

/** Collects the filter conditions for one BGP or path, checking every resource term once. */
class Checks {
  private readonly conditions: Op[] = [];
  private readonly seen = new Set<string>();

  /**
   * Adds the visibility checks for a resource. `mayBeLiteral` is set for object positions: a
   * variable there is often bound to a literal, which can never be a hidden resource, so the
   * (expensive) checks are skipped for it at runtime.
   */
  public resource(t: RDF.Term, visible: (t: RDF.Term) => Op[], mayBeLiteral = false): void {
    if (t.termType === 'Literal') {
      return;
    }
    const key = `${t.termType}:${t.value}`;
    if (this.seen.has(key)) {
      return;
    }
    this.seen.add(key);
    const checks = visible(t);
    if (checks.length === 0) {
      return;
    }
    this.conditions.push(mayBeLiteral && t.termType === 'Variable' ?
      operator('||', [operator('isliteral', [termExpr(t)]), and(checks)]) :
      and(checks));
  }

  public add(condition: Op | null): void {
    if (condition) {
      this.conditions.push(condition);
    }
  }

  public addOnce(key: string, condition: Op): void {
    if (!this.seen.has(key)) {
      this.seen.add(key);
      this.conditions.push(condition);
    }
  }

  public wrap(node: Op): Op {
    return this.conditions.length === 0 ? node : filter(and(this.conditions), node);
  }
}

/**
 * Property paths are checked on their end points only. Paths whose intermediate nodes or
 * predicates cannot be checked are refused.
 */
function checkPath(path: Op, policy: EffectivePolicy): void {
  const hidden = new Set(policy.hiddenProperties.flatMap(r => r.predicates));
  visit(path, (node) => {
    if (node.type === 'link' && hidden.has(node.iri.value)) {
      throw new AccessDenied(`Property paths over the hidden property <${node.iri.value}> are not allowed`);
    }
    if (node.type === 'nps' && hidden.size > 0) {
      throw new UnsupportedQuery('Negated property sets are not allowed when properties are hidden');
    }
    if ((node.type === 'ZeroOrMorePath' || node.type === 'OneOrMorePath') &&
      policy.visibility.length > 0 && !policy.allowTransitivePaths) {
      throw new UnsupportedQuery(
        'Transitive property paths (* and +) are not allowed under row-level policies: their intermediate nodes cannot be checked',
      );
    }
  });
}
