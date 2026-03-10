#!/usr/bin/env node
import { program } from '../src/index.mjs';

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
