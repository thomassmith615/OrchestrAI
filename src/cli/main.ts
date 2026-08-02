#!/usr/bin/env node
/**
 * Executable entry point for the `orch` binary.
 */
import { run } from "./run.js";

const exitCode = await run({ argv: process.argv.slice(2) });

process.exitCode = exitCode;
