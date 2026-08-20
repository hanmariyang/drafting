// Side-effect-only module: sets test env BEFORE any config-reading module in
// the graph is evaluated. Static imports are evaluated depth-first, so importing
// this module first (from setup.ts) guarantees these run before config.ts —
// under ESM the top-level statements of setup.ts would otherwise run AFTER its
// hoisted imports had already read process.env (empty), selecting a BYOK
// provider instead of the offline stub.
process.env.AI_STUB = '1';
process.env.APP_ENCRYPTION_KEY = Buffer.from(
  'drafting--test-master-key-32byte',
).toString('base64');
process.env.LOG_LEVEL = 'silent';
