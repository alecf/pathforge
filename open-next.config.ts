import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Pages are either fully static or rendered per request; nothing uses ISR or
// `revalidate`, so there is no incremental cache to configure.
export default defineCloudflareConfig({});
