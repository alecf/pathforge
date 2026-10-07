/// <reference types="@cloudflare/workers-types" />

// Bindings from wrangler.jsonc. OpenNext declares its own (ASSETS,
// WORKER_SELF_REFERENCE, ...) on the same global interface.
interface CloudflareEnv {
  HYPERDRIVE: Hyperdrive;
}
