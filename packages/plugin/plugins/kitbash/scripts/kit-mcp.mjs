#!/usr/bin/env node
// Stdio MCP server entry (referenced by .mcp.json and the Codex manifest). Runs in the project's directory.
import { loadKit } from "./load-kit.mjs";

const kit = await loadKit();
await kit.main();
