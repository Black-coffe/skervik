#!/usr/bin/env bash
# VULYK CI mirror - runs CI once per release on real macOS, on a private copy of the repo (plan CI3).
#
#   Usage: bash scripts/ci-mirror.sh           # checks the remote and says what --push would send; pushes nothing
#          bash scripts/ci-mirror.sh --push    # sends HEAD as ci/<version>-<sha7>, starts the workflow, waits
#
# The remote is `ci-mirror`, a private GitHub repository the owner creates and adds himself. Refused (exit 1,
# nothing pushed): no `ci-mirror` remote (prints the setup step), no `gh`, or a remote whose visibility is not
# `PRIVATE` (`PUBLIC`, or no answer). `--push` sends one branch, never a tag (`--no-follow-tags`), never by force;
# then `gh workflow run ci.yml --ref <branch>` and `gh run watch --exit-status`: exit 0 green, 1 red or not started.
# /vulyk-ship asks the owner one question before it runs `--push`. Knob: VULYK_GH (the gh binary, for tests).
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "ci-mirror: not inside a git checkout" >&2; exit 2; }
cd "$ROOT" || exit 2
PUSH=0
case "${1:-}" in
  --push) PUSH=1 ;;
  "") ;;
  *) echo "usage: bash scripts/ci-mirror.sh [--push]" >&2; exit 2 ;;
esac
GH="${VULYK_GH:-gh}"
WFILE=ci.yml

url="$(git remote get-url ci-mirror 2>/dev/null)" || {
  echo "ci-mirror: refused - no 'ci-mirror' remote. Setup (the owner, once): create a private GitHub repository, then" >&2
  echo "  git remote add ci-mirror https://github.com/<owner>/<private-repo>.git" >&2
  exit 1
}
repo="$(printf '%s\n' "$url" | sed -E 's#^.*github\.com[:/]##; s#\.git$##; s#/$##')"
case "$repo" in */*) ;; *) echo "ci-mirror: refused - the ci-mirror remote ($url) is not a GitHub repository" >&2; exit 1 ;; esac
command -v "$GH" >/dev/null 2>&1 || { echo "ci-mirror: refused - gh is not on PATH, so the remote's visibility cannot be checked" >&2; exit 1; }
vis="$("$GH" repo view "$repo" --json visibility -q .visibility 2>/dev/null | tr -d '\r[:space:]')"
if [ "$vis" != PRIVATE ]; then
  echo "ci-mirror: refused - $repo answers '${vis:-no answer}', not PRIVATE; nothing is pushed" >&2
  exit 1
fi

sha="$(git rev-parse -q --verify HEAD)" || { echo "ci-mirror: no commit at HEAD" >&2; exit 2; }
ver="$(git show HEAD:VERSION 2>/dev/null | head -n 1 | tr -d '\r[:space:]')"; [ -n "$ver" ] || ver=0.0.0
branch="ci/$ver-${sha:0:7}"
if [ "$PUSH" = 0 ]; then
  echo "ci-mirror: $repo is PRIVATE; would push HEAD ${sha:0:7} as $branch and run $WFILE there. Nothing pushed: run with --push"
  exit 0
fi

git push --no-follow-tags ci-mirror "$sha:refs/heads/$branch" || { echo "ci-mirror: the push of $branch failed; nothing forced" >&2; exit 1; }
"$GH" workflow run "$WFILE" --repo "$repo" --ref "$branch" || { echo "ci-mirror: could not start $WFILE on $branch" >&2; exit 1; }
id=""; tries=0
while [ -z "$id" ] && [ "$tries" -lt 12 ]; do
  id="$("$GH" run list --repo "$repo" --workflow "$WFILE" --branch "$branch" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null | tr -d '\r[:space:]')"
  [ -n "$id" ] || { tries=$((tries + 1)); sleep 5; }
done
[ -n "$id" ] || { echo "ci-mirror: no run of $WFILE appeared on $branch within a minute" >&2; exit 1; }
echo "ci-mirror: run $id on $branch"
if "$GH" run watch "$id" --repo "$repo" --exit-status; then echo "ci-mirror: green on $branch"; exit 0; fi
echo "ci-mirror: red on $branch (gh run view $id --repo $repo --log-failed)" >&2
exit 1
