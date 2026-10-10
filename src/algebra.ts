/**
 * Small helpers around Traqula's SPARQL algebra: parsing, generating, building nodes
 * and turning the SPARQL expressions produced by the SHACL compiler into reusable templates.
 */
import { toAlgebra as toAlgebra11, toAst as toAst11 } from '@traqula/algebra-sparql-1-1';
import { toAlgebra as toAlgebra12, toAst as toAst12 } from '@traqula/algebra-sparql-1-2';
import { Generator as Generator11 } from '@traqula/generator-sparql-1-1';
import { Generator as Generator12 } from '@traqula/generator-sparql-1-2';
import { Parser as Parser11 } from '@traqula/parser-sparql-1-1';
import { Parser as Parser12 } from '@traqula/parser-sparql-1-2';
import { DataFactory } from 'n3';
import type * as RDF from '@rdfjs/types';
import { RESERVED_VAR_PREFIX } from './vocab.js';

/** Algebra nodes are plain JSON-like objects; we treat them structurally. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Op = any;

export const factory = DataFactory;

/** The SPARQL version queries are parsed and generated in. */
export type SparqlVersion = '1.1' | '1.2';

export function parseAst(query: string, version: SparqlVersion = '1.1'): Op {
  return version === '1.2' ? new Parser12().parse(query) : new Parser11().parse(query);
}

export function parseToAlgebra(query: string, version: SparqlVersion = '1.1'): Op {
  return astToAlgebra(parseAst(query, version), version);
}

export function astToAlgebra(ast: Op, version: SparqlVersion = '1.1'): Op {
  const options = { blankToVariable: true };
  return version === '1.2' ? toAlgebra12(ast as never, options) : toAlgebra11(ast as never, options);
}

export function generate(op: Op, version: SparqlVersion = '1.1'): string {
  // A generator must not be shared between concurrent calls, so create one per call.
  return version === '1.2' ?
    new Generator12().generate(toAst12(op) as never) :
    new Generator11().generate(toAst11(op) as never);
}

export const variable = (name: string): RDF.Variable => factory.variable(name);

export function termExpr(term: RDF.Term): Op {
  return { type: 'expression', subType: 'term', term };
}

export function operator(op: string, args: Op[]): Op {
  return { type: 'expression', subType: 'operator', operator: op, args };
}

export function and(exprs: Op[]): Op {
  return exprs.reduce((acc, e) => operator('&&', [acc, e]));
}

export const FALSE = termExpr(factory.literal('false', factory.namedNode('http://www.w3.org/2001/XMLSchema#boolean')));

export function filter(expression: Op, input: Op): Op {
  return { type: 'filter', input, expression };
}

/**
 * Parses a SPARQL boolean expression into algebra.
 * Used once per policy rule when the policies are loaded.
 */
export function parseExpression(expression: string): Op {
  const op = parseToAlgebra(`ASK { FILTER(${expression}) }`);
  if (op.type !== 'ask' || op.input.type !== 'filter') {
    throw new Error(`Unexpected algebra for expression ${expression}`);
  }
  return reserveVariables(op.input.expression);
}

/**
 * Rewrites every triple and path pattern inside a policy expression so that it matches in the
 * active graph *or in any named graph of the dataset*: `{ t } UNION { GRAPH ?g { t } }`.
 *
 * Policy checks are injected next to the user's patterns, also inside `GRAPH` blocks. Without
 * this, a check like "is ?x an Employee?" would only look in the graph the user picked, and a user
 * could hide the `rdf:type` triple from the check by querying a different graph.
 */
export function spanGraphs(expression: Op): Op {
  let counter = 0;
  const anyGraph = (pattern: Op): Op => ({
    type: 'union',
    input: [pattern, { type: 'graph', input: pattern, name: variable(`${RESERVED_VAR_PREFIX}g${counter++}`) }],
  });
  return mapOps(expression, (op) => {
    if (op.type === 'bgp' && op.patterns.length > 0) {
      const parts = op.patterns.map((p: Op) => anyGraph({ type: 'bgp', patterns: [p] }));
      return parts.length === 1 ? parts[0] : { type: 'join', input: parts };
    }
    if (op.type === 'path') {
      return anyGraph(op);
    }
    return op;
  });
}

/** Replaces variables by name, everywhere in the tree. */
export function substitute(tree: Op, bindings: Record<string, RDF.Term>): Op {
  return mapVariables(tree, v => bindings[v.value] ?? v);
}

/**
 * Renames every variable of a policy expression into the reserved namespace, including the
 * ones Traqula generates for property path sequences (`?var0`). A plain name could be bound by
 * the user's query and would then change the meaning of the check through EXISTS substitution.
 */
export function reserveVariables(tree: Op): Op {
  return mapVariables(tree, v =>
    v.value.startsWith(RESERVED_VAR_PREFIX) ? v : variable(`${RESERVED_VAR_PREFIX}t_${v.value}`));
}

function mapVariables(tree: Op, fn: (v: RDF.Variable) => RDF.Term): Op {
  if (Array.isArray(tree)) {
    return tree.map(t => mapVariables(t, fn));
  }
  if (tree === null || typeof tree !== 'object') {
    return tree;
  }
  if (tree.termType === 'Variable' && tree.type === undefined) {
    return fn(tree);
  }
  const copy: Op = {};
  for (const [k, v] of Object.entries(tree)) {
    copy[k] = mapVariables(v, fn);
  }
  return copy;
}

/**
 * Bottom-up transform: children are transformed first, then `fn` is applied to every object that
 * has a `type` (operations, expressions, path symbols, patterns). RDF terms are left untouched.
 */
export function mapOps(tree: Op, fn: (op: Op) => Op): Op {
  if (Array.isArray(tree)) {
    return tree.map(t => mapOps(t, fn));
  }
  if (tree === null || typeof tree !== 'object' || tree.type === undefined) {
    return tree;
  }
  const copy: Op = {};
  for (const [k, v] of Object.entries(tree)) {
    copy[k] = mapOps(v, fn);
  }
  return fn(copy);
}

/** Calls `fn` for every typed node and every RDF term in the tree. */
export function visit(tree: Op, fn: (node: Op) => void): void {
  if (Array.isArray(tree)) {
    tree.forEach(t => visit(t, fn));
    return;
  }
  if (tree === null || typeof tree !== 'object') {
    return;
  }
  fn(tree);
  for (const v of Object.values(tree)) {
    visit(v, fn);
  }
}
