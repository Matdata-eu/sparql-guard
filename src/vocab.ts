/** Namespaces and terms used by sparql-guard. */

export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
export const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const SH = 'http://www.w3.org/ns/shacl#';
export const SG = 'https://matdata.eu/ns/sparql-guard#';

export const rdf = {
  type: `${RDF}type`,
  first: `${RDF}first`,
  rest: `${RDF}rest`,
  nil: `${RDF}nil`,
} as const;

export const rdfs = {
  subClassOf: `${RDFS}subClassOf`,
  label: `${RDFS}label`,
  comment: `${RDFS}comment`,
} as const;

/** The sparql-guard policy vocabulary. See docs/policy-language.md. */
export const sg = {
  Policy: `${SG}Policy`,
  agent: `${SG}agent`,
  group: `${SG}group`,
  Anyone: `${SG}Anyone`,
  AuthenticatedAgent: `${SG}AuthenticatedAgent`,
  readGraph: `${SG}readGraph`,
  readAllGraphs: `${SG}readAllGraphs`,
  visibleIf: `${SG}visibleIf`,
  hideProperties: `${SG}hideProperties`,
  hideReferences: `${SG}hideReferences`,
  allowTransitivePaths: `${SG}allowTransitivePaths`,
  requestingAgent: `${SG}requestingAgent`,
} as const;

/** Graph IRI that is used whenever a query must run against an empty dataset part. */
export const EMPTY_GRAPH = 'urn:sparql-guard:empty-graph';

/** IRI substituted for {@link sg.requestingAgent} when the request is anonymous. */
export const ANONYMOUS_AGENT = 'urn:sparql-guard:anonymous';

/** Prefix reserved for variables that sparql-guard injects. User queries may not use it. */
export const RESERVED_VAR_PREFIX = '__sg_';
