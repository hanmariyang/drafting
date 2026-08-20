// Must be imported FIRST in every test file so env is set before config.ts
// evaluates. Uses the offline stub AI provider and a fixed master key.
// The env is set in ./env.ts (a side-effect-only import) so that, under ESM
// depth-first evaluation, it runs before the config-reading imports below.
import './env.ts';
import { openMemoryDb, setDb } from '../src/db/index.ts';

/** Fresh in-memory db for a test. Returns nothing; installs it as the singleton. */
export function freshDb(): void {
  setDb(openMemoryDb());
}
