export function expectDefined<T>(
	value: T | undefined | null,
	message = "expected defined value",
): T {
	if (value === undefined || value === null) throw new Error(message);
	return value;
}

/**
 * spawnSync options for `git` calls in tests.
 *
 * Strips `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env vars inherited from the
 * parent process. Git sets those when running pre-commit hooks, and they
 * override the test's local `git config user.email` (highest precedence
 * is env vars, then local config, then global). Without this, tests run
 * from inside another commit's pre-commit hook attribute their fixture
 * commits to the outer committer instead of Alice/Bob.
 */
export function gitTestSpawnOptions(cwd: string): {
	cwd: string;
	encoding: "utf8";
	env: NodeJS.ProcessEnv;
} {
	const env = { ...process.env };
	for (const key of [
		"GIT_AUTHOR_NAME",
		"GIT_AUTHOR_EMAIL",
		"GIT_COMMITTER_NAME",
		"GIT_COMMITTER_EMAIL",
		"GIT_AUTHOR_DATE",
		"GIT_COMMITTER_DATE",
	]) {
		delete env[key];
	}
	return { cwd, encoding: "utf8", env };
}
