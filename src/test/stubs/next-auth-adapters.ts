/**
 * `next-auth/adapters` is a types-only subpath: its package export map has a
 * `types` condition and nothing else. `src/server/db/schema.ts` imports
 * `AdapterAccount` from it, and under `verbatimModuleSyntax` that import
 * survives transpilation as a side-effect import, which Vite cannot resolve.
 * Aliasing it to this empty module keeps the runtime import harmless while
 * `tsc` still type-checks against the real declarations.
 */
export {};
