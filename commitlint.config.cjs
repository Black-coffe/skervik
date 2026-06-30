// commitlint.config.cjs — CommonJS required because root package.json has "type":"module".
// Enforces Conventional Commits (feat/fix/chore/docs/... with optional scope + body).
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
