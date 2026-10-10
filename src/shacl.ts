/**
 * Compiles a (supported subset of) SHACL shapes into SPARQL boolean expressions.
 *
 * The output is SPARQL text over the placeholder variable `?__sg_this` (the focus node).
 * It is parsed into algebra once, when the policies are loaded, and the placeholder is
 * substituted with the actual subject/object term of each data pattern at query time.
 *
 * Everything that is not understood fails loudly: an access policy that silently ignores
 * part of a shape would grant more than its author intended.
 */
import type { Quad_Object, Store, Term } from 'n3';
import { rdf, rdfs, SH, sg, XSD } from './vocab.js';

export const THIS = '?__sg_this';
export const AGENT = '?__sg_agent';

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

const sh = (local: string): string => `${SH}${local}`;

/** Predicates in the sh: namespace that may appear on a shape without changing its meaning here. */
const DESCRIPTIVE = new Set([
  'name', 'description', 'message', 'severity', 'order', 'group', 'defaultValue',
  'targetClass', 'targetNode', 'targetSubjectsOf', 'targetObjectsOf',
].map(sh));

/** Constraint components this compiler can translate. */
const SUPPORTED = new Set([
  'property', 'path', 'deactivated',
  'class', 'datatype', 'nodeKind',
  'minInclusive', 'maxInclusive', 'minExclusive', 'maxExclusive',
  'minLength', 'maxLength', 'pattern', 'flags', 'languageIn', 'in', 'hasValue',
  'node', 'not', 'and', 'or', 'xone',
  'minCount', 'maxCount', 'equals', 'disjoint',
].map(sh));

const MAX_COUNT_EXPANSION = 8;

export class ShaclCompiler {
  private counter = 0;

  public constructor(private readonly store: Store) {}

  /**
   * Expression that is true when `?__sg_this` may be shown under a `sg:visibleIf` shape:
   * either it is not a target of the shape, or it conforms to it.
   */
  public visibility(shape: Term): string {
    const conforms = this.conforms(shape, THIS, []);
    const targets = this.targets(shape, THIS);
    if (targets.length === 0) {
      return conforms;
    }
    return targets.map(t => `NOT EXISTS { ${t} FILTER(!(${conforms})) }`).join(' && ');
  }

  /**
   * Reads a `sg:hideProperties` shape: its targets (empty means every subject) and the
   * predicates listed as `sh:property [ sh:path <p> ]`.
   */
  public hiddenProperties(shape: Term): { isTarget: string | null; predicates: string[] } {
    const predicates: string[] = [];
    for (const prop of this.objects(shape, sh('property'))) {
      const path = this.one(prop, sh('path'));
      if (!path || path.termType !== 'NamedNode') {
        throw new PolicyError(`sg:hideProperties shape ${label(shape)} needs sh:property entries with a plain IRI sh:path`);
      }
      predicates.push(path.value);
    }
    if (predicates.length === 0) {
      throw new PolicyError(`sg:hideProperties shape ${label(shape)} lists no properties`);
    }
    const targets = this.targets(shape, THIS);
    return {
      isTarget: targets.length === 0 ? null : targets.map(t => `EXISTS { ${t} }`).join(' || '),
      predicates,
    };
  }

  /** Graph patterns that bind nothing but match when `focus` is a target of `shape`. */
  public targets(shape: Term, focus: string): string[] {
    const out: string[] = [];
    for (const cls of this.objects(shape, sh('targetClass'))) {
      out.push(`${focus} <${rdf.type}>/<${rdfs.subClassOf}>* ${this.term(cls)} .`);
    }
    for (const node of this.objects(shape, sh('targetNode'))) {
      out.push(`FILTER(sameTerm(${focus}, ${this.term(node)}))`);
    }
    for (const p of this.objects(shape, sh('targetSubjectsOf'))) {
      out.push(`${focus} ${this.term(p)} ${this.fresh()} .`);
    }
    for (const p of this.objects(shape, sh('targetObjectsOf'))) {
      out.push(`${this.fresh()} ${this.term(p)} ${focus} .`);
    }
    return out;
  }

  /** Expression that is true when `focus` conforms to `shape`. */
  public conforms(shape: Term, focus: string, stack: Term[]): string {
    if (stack.some(s => s.equals(shape))) {
      throw new PolicyError(`Recursive shape reference through ${label(shape)} is not supported`);
    }
    stack = [...stack, shape];
    this.checkSupported(shape);
    if (this.boolean(shape, sh('deactivated'))) {
      return 'true';
    }
    const path = this.one(shape, sh('path'));
    const parts = path ?
      this.propertyConstraints(shape, focus, this.path(path), stack) :
      this.nodeConstraints(shape, focus, stack);
    for (const prop of this.objects(shape, sh('property'))) {
      if (!this.one(prop, sh('path'))) {
        throw new PolicyError(`Property shape ${label(prop)} has no sh:path`);
      }
      parts.push(this.conforms(prop, focus, stack));
    }
    return and(parts);
  }

  /** Constraints of a property shape: they talk about the value nodes reached via `path`. */
  private propertyConstraints(shape: Term, focus: string, path: string, stack: Term[]): string[] {
    const parts: string[] = [];
    for (const value of this.objects(shape, sh('hasValue'))) {
      parts.push(`EXISTS { ${focus} ${path} ${this.term(value)} . }`);
    }
    const minCount = this.integer(shape, sh('minCount'));
    if (minCount !== undefined && minCount > 0) {
      parts.push(`EXISTS { ${this.distinctValues(focus, path, minCount)} }`);
    }
    const maxCount = this.integer(shape, sh('maxCount'));
    if (maxCount !== undefined) {
      parts.push(maxCount === 0 ?
        `NOT EXISTS { ${focus} ${path} ${this.fresh()} . }` :
        `NOT EXISTS { ${this.distinctValues(focus, path, maxCount + 1)} }`);
    }
    for (const other of this.objects(shape, sh('equals'))) {
      const v = this.fresh();
      const p = this.term(other);
      parts.push(`NOT EXISTS { ${focus} ${path} ${v} . FILTER NOT EXISTS { ${focus} ${p} ${v} . } }`);
      parts.push(`NOT EXISTS { ${focus} ${p} ${v} . FILTER NOT EXISTS { ${focus} ${path} ${v} . } }`);
    }
    for (const other of this.objects(shape, sh('disjoint'))) {
      const v = this.fresh();
      parts.push(`NOT EXISTS { ${focus} ${path} ${v} . ${focus} ${this.term(other)} ${v} . }`);
    }
    // Every other constraint must hold for each value node: there may be no value that fails it.
    const v = this.fresh();
    for (const check of this.valueChecks(shape, v, stack)) {
      parts.push(`NOT EXISTS { ${focus} ${path} ${v} . FILTER(!(COALESCE(${check}, false))) }`);
    }
    return parts;
  }

  /** Constraints of a node shape: they talk about the focus node itself. */
  private nodeConstraints(shape: Term, focus: string, stack: Term[]): string[] {
    for (const unsupported of ['minCount', 'maxCount', 'equals', 'disjoint']) {
      if (this.one(shape, sh(unsupported))) {
        throw new PolicyError(`sh:${unsupported} on node shape ${label(shape)} needs a sh:path`);
      }
    }
    const parts = this.objects(shape, sh('hasValue')).map(v => `sameTerm(${focus}, ${this.term(v)})`);
    for (const check of this.valueChecks(shape, focus, stack)) {
      parts.push(`COALESCE(${check}, false)`);
    }
    return parts;
  }

  /** Value-node constraints shared by node shapes and property shapes, as expressions over `v`. */
  private valueChecks(shape: Term, v: string, stack: Term[]): string[] {
    const checks: string[] = [];
    for (const cls of this.objects(shape, sh('class'))) {
      checks.push(`EXISTS { ${v} <${rdf.type}>/<${rdfs.subClassOf}>* ${this.term(cls)} . }`);
    }
    for (const dt of this.objects(shape, sh('datatype'))) {
      checks.push(`(isLiteral(${v}) && sameTerm(datatype(${v}), ${this.term(dt)}))`);
    }
    for (const kind of this.objects(shape, sh('nodeKind'))) {
      checks.push(nodeKind(kind, v));
    }
    const comparisons: [string, string][] = [
      ['minInclusive', '>='], ['maxInclusive', '<='], ['minExclusive', '>'], ['maxExclusive', '<'],
    ];
    for (const [local, op] of comparisons) {
      for (const bound of this.objects(shape, sh(local))) {
        checks.push(`(${v} ${op} ${this.term(bound)})`);
      }
    }
    const minLength = this.integer(shape, sh('minLength'));
    if (minLength !== undefined) {
      checks.push(`(!isBlank(${v}) && STRLEN(STR(${v})) >= ${minLength})`);
    }
    const maxLength = this.integer(shape, sh('maxLength'));
    if (maxLength !== undefined) {
      checks.push(`(!isBlank(${v}) && STRLEN(STR(${v})) <= ${maxLength})`);
    }
    const flags = this.one(shape, sh('flags'));
    for (const pattern of this.objects(shape, sh('pattern'))) {
      const flagArg = flags ? `, ${stringLiteral(flags.value)}` : '';
      checks.push(`(!isBlank(${v}) && REGEX(STR(${v}), ${stringLiteral(pattern.value)}${flagArg}))`);
    }
    for (const list of this.objects(shape, sh('languageIn'))) {
      const tags = this.list(list).map(t => `langMatches(lang(${v}), ${stringLiteral(t.value)})`);
      checks.push(`(isLiteral(${v}) && (${tags.length > 0 ? tags.join(' || ') : 'false'}))`);
    }
    for (const list of this.objects(shape, sh('in'))) {
      const members = this.list(list).map(t => `sameTerm(${v}, ${this.term(t)})`);
      checks.push(`(${members.length > 0 ? members.join(' || ') : 'false'})`);
    }
    for (const node of this.objects(shape, sh('node'))) {
      checks.push(this.conforms(node, v, stack));
    }
    for (const node of this.objects(shape, sh('not'))) {
      checks.push(`!(${this.conforms(node, v, stack)})`);
    }
    for (const list of this.objects(shape, sh('and'))) {
      checks.push(and(this.list(list).map(s => this.conforms(s, v, stack))));
    }
    for (const list of this.objects(shape, sh('or'))) {
      const members = this.list(list).map(s => `(${this.conforms(s, v, stack)})`);
      checks.push(`(${members.length > 0 ? members.join(' || ') : 'false'})`);
    }
    for (const list of this.objects(shape, sh('xone'))) {
      const members = this.list(list).map(s => `IF(${this.conforms(s, v, stack)}, 1, 0)`);
      checks.push(`((${members.length > 0 ? members.join(' + ') : '0'}) = 1)`);
    }
    return checks;
  }

  /** A group pattern that matches when `focus` has at least `n` distinct values for `path`. */
  private distinctValues(focus: string, path: string, n: number): string {
    if (n > MAX_COUNT_EXPANSION) {
      throw new PolicyError(`Cardinality ${n} is too large; at most ${MAX_COUNT_EXPANSION} is supported`);
    }
    const vars = Array.from({ length: n }, () => this.fresh());
    const triples = vars.map(v => `${focus} ${path} ${v} .`).join(' ');
    const distinct: string[] = [];
    for (let i = 0; i < vars.length; i++) {
      for (let j = i + 1; j < vars.length; j++) {
        distinct.push(`!sameTerm(${vars[i]}, ${vars[j]})`);
      }
    }
    return distinct.length > 0 ? `${triples} FILTER(${distinct.join(' && ')})` : triples;
  }

  /** Renders a SHACL property path as a SPARQL property path. */
  private path(node: Term): string {
    if (node.termType === 'NamedNode') {
      return this.term(node);
    }
    if (this.one(node, rdf.first)) {
      return `(${this.list(node).map(p => this.path(p)).join('/')})`;
    }
    const inverse = this.one(node, sh('inversePath'));
    if (inverse) {
      return `^(${this.path(inverse)})`;
    }
    const alternatives = this.one(node, sh('alternativePath'));
    if (alternatives) {
      return `(${this.list(alternatives).map(p => this.path(p)).join('|')})`;
    }
    for (const [local, op] of [['zeroOrMorePath', '*'], ['oneOrMorePath', '+'], ['zeroOrOnePath', '?']]) {
      const inner = this.one(node, sh(local));
      if (inner) {
        return `(${this.path(inner)})${op}`;
      }
    }
    throw new PolicyError(`Unsupported sh:path ${label(node)}`);
  }

  /** Renders an RDF term as SPARQL; `sg:requestingAgent` becomes a placeholder variable. */
  private term(t: Term): string {
    if (t.termType === 'NamedNode') {
      return t.value === sg.requestingAgent ? AGENT : iri(t.value);
    }
    if (t.termType === 'Literal') {
      if (t.language) {
        return `${stringLiteral(t.value)}@${t.language}`;
      }
      if (t.datatype.value === `${XSD}string`) {
        return stringLiteral(t.value);
      }
      return `${stringLiteral(t.value)}^^${iri(t.datatype.value)}`;
    }
    throw new PolicyError(`A ${t.termType} cannot be used as a value in an access policy (${t.value})`);
  }

  private checkSupported(shape: Term): void {
    for (const quad of this.store.getQuads(shape, null, null, null)) {
      const p = quad.predicate.value;
      if (p.startsWith(SH) && !SUPPORTED.has(p) && !DESCRIPTIVE.has(p)) {
        throw new PolicyError(`${p.slice(SH.length)} on shape ${label(shape)} is not supported by sparql-guard`);
      }
    }
  }

  private fresh(): string {
    return `?__sg_v${this.counter++}`;
  }

  private objects(subject: Term, predicate: string): Quad_Object[] {
    return this.store.getObjects(subject, predicate, null);
  }

  private one(subject: Term, predicate: string): Quad_Object | undefined {
    const values = this.objects(subject, predicate);
    if (values.length > 1) {
      throw new PolicyError(`${label(subject)} has more than one ${predicate}`);
    }
    return values[0];
  }

  private boolean(subject: Term, predicate: string): boolean {
    return this.one(subject, predicate)?.value === 'true';
  }

  private integer(subject: Term, predicate: string): number | undefined {
    const value = this.one(subject, predicate);
    if (!value) {
      return undefined;
    }
    const n = Number(value.value);
    if (!Number.isInteger(n) || n < 0) {
      throw new PolicyError(`${predicate} on ${label(subject)} must be a non-negative integer`);
    }
    return n;
  }

  private list(head: Term): Quad_Object[] {
    const items: Quad_Object[] = [];
    let node: Term | undefined = head;
    while (node && node.value !== rdf.nil) {
      const first = this.one(node, rdf.first);
      if (!first) {
        throw new PolicyError(`${label(head)} is not a well-formed RDF list`);
      }
      items.push(first);
      node = this.one(node, rdf.rest);
    }
    return items;
  }
}

function and(parts: string[]): string {
  if (parts.length === 0) {
    return 'true';
  }
  return parts.length === 1 ? parts[0] : `(${parts.map(p => `(${p})`).join(' && ')})`;
}

function nodeKind(kind: Term, v: string): string {
  const kinds: Record<string, string> = {
    IRI: `isIRI(${v})`,
    BlankNode: `isBlank(${v})`,
    Literal: `isLiteral(${v})`,
    BlankNodeOrIRI: `(isBlank(${v}) || isIRI(${v}))`,
    BlankNodeOrLiteral: `(isBlank(${v}) || isLiteral(${v}))`,
    IRIOrLiteral: `(isIRI(${v}) || isLiteral(${v}))`,
  };
  const check = kind.value.startsWith(SH) ? kinds[kind.value.slice(SH.length)] : undefined;
  if (!check) {
    throw new PolicyError(`Unknown sh:nodeKind ${kind.value}`);
  }
  return check;
}

function iri(value: string): string {
  if (/[\u0000- <>"{}|^`\\]/u.test(value)) {
    throw new PolicyError(`Invalid IRI in policy: ${value}`);
  }
  return `<${value}>`;
}

function stringLiteral(value: string): string {
  return `"${value
    .replace(/\\/gu, '\\\\')
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, '\\n')
    .replace(/\r/gu, '\\r')
    .replace(/\t/gu, '\\t')}"`;
}

export function label(t: Term): string {
  return t.termType === 'BlankNode' ? `_:${t.value}` : `<${t.value}>`;
}
