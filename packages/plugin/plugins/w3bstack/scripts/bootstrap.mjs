#!/usr/bin/env node
// Works from an installed plugin bundle or the source checkout, with the same CLI contract.
import { loadKit } from "./load-kit.mjs";
import { createInterface } from "node:readline/promises";

const kit = await loadKit();
const { io } = kit.makeIo();
io.out = (text) => process.stdout.write(text);
io.err = (text) => process.stderr.write(text);
if (process.stdin.isTTY && process.stdout.isTTY) {
  io.prompt = async (question) => {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try { return await terminal.question(question); } finally { terminal.close(); }
  };
}
process.exitCode = await kit.runBootstrap(process.argv.slice(2), io);
