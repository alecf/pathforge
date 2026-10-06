/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/** @type {import("next").NextConfig} */
const config = {};

export default config;

// Exposes Cloudflare bindings (e.g. HYPERDRIVE) to `next dev` via getCloudflareContext().
void initOpenNextCloudflareForDev();
