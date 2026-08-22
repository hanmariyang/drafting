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
// 백업/복원 테스트가 레포의 data/ 대신 임시 경로를 쓰게 한다(부작용 격리).
process.env.DATABASE_PATH = `${process.env.TMPDIR ?? '/tmp'}/drafting-test-${process.pid}.sqlite`;
