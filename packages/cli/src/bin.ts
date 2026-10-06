import { run } from './program.ts';

process.exitCode = await run(process.argv.slice(2));
