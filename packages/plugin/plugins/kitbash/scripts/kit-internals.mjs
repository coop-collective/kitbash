// The two CLI modules the CLI package does not re-export from its programmatic entry (settings and the sign-in
// files). Imported by relative path so the plugin reads credentials exactly as `kit` does (KIT_TOKEN, ~/.kit/credentials,
// KIT_API_URL, KIT_REGISTRY_PUBLIC_KEY) instead of re-implementing them. The bundle (`pnpm -F @kitbash/plugin build`)
// inlines this, so a built plugin needs no neighbouring package.
export { loadSettings } from "../../../../cli/src/config.ts";
