export { authenticate, AuthError, hashKey } from './auth.js';
export { loadConfig, type Config } from './config.js';
export { PolicySet, type EffectivePolicy, type Policy, type Requester } from './policy.js';
export { AccessDenied, rewriteQuery, UnsupportedQuery, type Dataset, type RewriteResult } from './rewrite.js';
export { createGuardServer } from './server.js';
export { PolicyError } from './shacl.js';
export * from './vocab.js';
