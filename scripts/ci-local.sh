#!/usr/bin/env bash
# VULYK local CI - runs the jobs of .github/workflows/ci.yml in two legs before a public push (plan CI1, CI2).
#
#   Usage: bash scripts/ci-local.sh [--leg linux|bash32] [--job <name>]   # run the legs, write the receipt
#          bash scripts/ci-local.sh --list                                # the jobs and their steps, nothing run
#          <git pre-push lines> | bash scripts/ci-local.sh --pushed <remote>   # the push rule (pre-push hook)
#
# Jobs and steps come from ci.yml at HEAD. A step runs when it has a `run:`; a `uses:` step, a step with `if:`,
# `env:` or `${{ }}`, and every step of a job with `if:` or `env:`, is skipped and named (no Actions runner, no
# guess). Legs: `linux` in WSL (`wsl -e bash`), `bash32` in docker (`docker run bash:3.2`); each gets a bundle of
# this repo and works in a fresh `git clone` of HEAD, never a copy of the working tree. A missing launcher, or a
# tool the steps need missing in the leg, skips that leg with one line saying how to add it. Each step runs as
# `bash -e <step>` from the clone's root; `npm install -g` lands in the leg's own temp prefix. What a runner gives
# the steps (af-tails-1120 CI4): RUNNER_TEMP, a fresh folder per job inside the leg; a `python` that runs python3
# when the leg has none; the node-version of a skipped actions/setup-node step (nodejs.org build, SHASUMS256-checked)
# when the leg node is older; an Alpine leg adds GNU coreutils/findutils/grep/sed/gawk/tar/diffutils/procps over busybox,
# and bash 5 at /bin/bash. The bash32 leg stands in for the macOS runner: a job whose runs-on or matrix names no
# macos-* runner runs under /bin/bash (CI runs it on Linux only), a macOS job under the bash 3.2 on PATH.
# Output: one line per step `<leg> <job>/<n> ok|FAIL|SKIP <reason>`, one per leg `LEG <leg>: ok|FAIL|skipped - <why>`.
# A full run (no --leg / --job) writes the receipt to `git rev-parse --git-path vulyk-ci-local`: `head=<sha>` and
# the LEG lines; a run with a FAIL writes none and removes an old one. A leg whose result lines do not match its
# manifest line for line is a FAIL. Exit 0 no FAIL, 1 a FAIL, 2 usage or no ci.yml.
#
# --pushed: a pushed ref that is the default branch (the remote's HEAD, else main) or `refs/tags/v*`, and not a
# deletion, needs a receipt for its commit with no FAIL leg; else exit 1 with the reason. A skipped leg passes
# with a NOTE line. Any other ref passes. Way off: `git push --no-verify`, the hook's own named bypass.
# Knobs (tests use stand-ins): VULYK_CI_WSL, VULYK_CI_DOCKER (the launchers), VULYK_CI_LEG_TOOLS (the tools a
# leg checks first, default "git jq python3 node npm"), VULYK_CI_IMAGE (default bash:3.2).
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "ci-local: not inside a git checkout" >&2; exit 2; }
cd "$ROOT" || exit 2
RECEIPT="$(git rev-parse --git-path vulyk-ci-local)"
WF=".github/workflows/ci.yml"

pushed() { # pushed <remote> - the push rule over git's pre-push lines on stdin
  local remote="$1" def lref lsha rref c want rec_head refused=0
  def="$(git symbolic-ref -q --short "refs/remotes/$remote/HEAD" 2>/dev/null)"; def="${def#"$remote"/}"
  [ -n "$def" ] || def=main
  while read -r lref lsha rref _rsha || [ -n "${lref:-}" ]; do
    lref="${lref%$'\r'}"; lsha="${lsha:-}"; rref="${rref:-}"
    [ -n "$lref" ] || continue
    case "$lsha" in *[!0]*) ;; *) continue ;; esac   # a deletion: nothing is pushed
    case "$rref" in "refs/heads/$def"|refs/tags/v*) ;; *) continue ;; esac
    c="$(git rev-parse -q --verify "$lsha^{commit}" 2>/dev/null)" || c="$lsha"
    want="${c:0:7}"
    if [ ! -f "$RECEIPT" ]; then
      echo "ci-local: refused - $rref pushes $want with no local CI receipt; run bash scripts/ci-local.sh on that commit first" >&2
      refused=1; continue
    fi
    rec_head="$(sed -n 's/^head=//p' "$RECEIPT" | head -n 1 | tr -d '\r')"
    if [ "$rec_head" != "$c" ]; then
      echo "ci-local: refused - $rref pushes $want, the local CI receipt is for ${rec_head:0:7}; run bash scripts/ci-local.sh again" >&2
      refused=1; continue
    fi
    if ! grep -q '^LEG ' "$RECEIPT"; then
      echo "ci-local: refused - the local CI receipt for $want holds no leg line; run bash scripts/ci-local.sh again" >&2
      refused=1; continue
    fi
    if grep -q '^LEG [a-z0-9]*: FAIL' "$RECEIPT"; then
      echo "ci-local: refused - the local CI receipt for $want holds a FAIL: $(grep '^LEG [a-z0-9]*: FAIL' "$RECEIPT" | head -n 1)" >&2
      refused=1; continue
    fi
    grep '^LEG [a-z0-9]*: skipped' "$RECEIPT" | while IFS= read -r l; do
      echo "ci-local: NOTE - $rref goes out with a leg not run: ${l#LEG }" >&2
    done
  done
  return "$refused"
}

parse() { # parse <ci.yml> <dir> - writes <dir>/manifest (job TAB n TAB run|SKIP TAB label|reason) and <dir>/<job>.<n>.sh
  D="$2" awk -v q="'" '
  BEGIN { D = ENVIRON["D"] }
  function ind(s) { match(s, /^ */); return RLENGTH }
  function keyof(s) { sub(/^ */, "", s); sub(/:.*/, "", s); return s }
  function valof(s) { sub(/^ *[A-Za-z0-9_-]+:[ ]?/, "", s); return s }
  function unq(s,   a, z) {
    a = substr(s, 1, 1); z = substr(s, length(s), 1)
    if (length(s) > 1 && a == z && (a == "\"" || a == q)) s = substr(s, 2, length(s) - 2)
    return s
  }
  function endstep() {
    if (n == 0 || sdone) return
    sdone = 1; reason = ""
    if (suses != "") reason = "uses: " suses
    else if (sif != "") reason = "if: " sif
    else if (sexpr) reason = "holds ${{ }}"
    else if (senv) reason = "env: not evaluated here"
    else if (sfold) reason = "run: > (folded) not evaluated here"
    else if (!shasrun) reason = "no run:"
    if (reason == "") {
      f = D "/" job "." n ".sh"; printf "%s", srun > f; close(f)
      lab = sname; if (lab == "") { lab = srun; sub(/\n.*/, "", lab) }
      st[n] = "run"; tx[n] = lab
    } else { st[n] = "SKIP"; tx[n] = reason }
  }
  function endjob(   i, r) {
    endstep()
    if (job == "") return
    for (i = 1; i <= n; i++) {
      r = tx[i]
      if (jif != "") { st[i] = "SKIP"; r = "job if: " jif }
      else if (jenv) { st[i] = "SKIP"; r = "job env: not evaluated here" }
      printf "%s\t%d\t%s\t%s\n", job, i, st[i], r > (D "/manifest")
    }
    if (n == 0) printf "%s\t0\tSKIP\tno steps\n", job > (D "/manifest")
    if (jmac) print job > (D "/macos.jobs")
    job = ""; n = 0
  }
  function newstep() { endstep(); n++; sdone = 0; sname = ""; srun = ""; suses = ""; sif = ""; senv = 0; sexpr = 0; sfold = 0; shasrun = 0 }
  {
    sub(/\r$/, "")
    line = $0
    if (inblk) {
      if (line ~ /^[ ]*$/ || ind(line) > bki) {
        if (line !~ /^[ ]*$/ && bi < 0) bi = ind(line)
        if (index(line, "${{")) sexpr = 1
        piece = (line ~ /^[ ]*$/) ? "" : substr(line, bi + 1)
        srun = srun piece "\n"
        next
      }
      inblk = 0
    }
    if (line ~ /^[ ]*$/ || line ~ /^[ ]*#/) next
    i = ind(line)
    if (i == 0) { endjob(); injobs = (line ~ /^jobs:[ ]*(#.*)?$/); next }
    if (!injobs) next
    if (i == 2 && line ~ /^  [A-Za-z0-9_-]+:[ ]*(#.*)?$/) { endjob(); job = keyof(line); insteps = 0; jif = ""; jenv = 0; jmac = 0; si = -1; n = 0; next }
    if (job == "") next
    if (insteps && i <= 4) insteps = 0
    if (!insteps) {
      if (line ~ /[Mm]ac[Oo][Ss]-/) jmac = 1   # runs-on or its matrix names a macOS runner
      if (i == 4) {
        k = keyof(line)
        if (k == "steps") { insteps = 1; si = -1 }
        else if (k == "if") jif = valof(line)
        else if (k == "env") jenv = 1
      }
      next
    }
    if (line ~ /^ *- /) {
      if (si < 0) si = i
      if (i == si) { newstep(); line = substr(line, 1, i) "  " substr(line, i + 3) }
    }
    if (n == 0) next
    if (index(line, "${{")) sexpr = 1
    if (suses ~ /actions\/setup-node@/ && line ~ /^ *node-version:/) {   # the node a skipped setup-node step gives
      v = valof(line); gsub(q, "", v); gsub(/"/, "", v); sub(/[^0-9].*/, "", v)
      if (v + 0 > nodev) nodev = v + 0
    }
    if (ind(line) != si + 2 || line !~ /^ *[A-Za-z0-9_-]+:/) next
    k = keyof(line); v = valof(line)
    if (k == "run") {
      shasrun = 1
      if (v ~ /^\|[-+]?[ ]*(#.*)?$/) { inblk = 1; bki = si + 2; bi = -1; srun = "" }
      else if (v ~ /^>/) { sfold = 1; inblk = 1; bki = si + 2; bi = -1 }
      else srun = unq(v) "\n"
    }
    else if (k == "uses") suses = v
    else if (k == "if") sif = v
    else if (k == "env") senv = 1
    else if (k == "name") sname = unq(v)
  }
  END { endjob(); if (nodev) print nodev > (D "/node.version") }' "$1"
}

leg_script() { # the script each leg runs inside WSL or the container: tools, clone, steps
  cat <<'LEG'
set -u
leg="$1"; sha="$2"; d="$(cd "$(dirname "$0")" && pwd)"
missing() { m=""; for t in $(cat "$d/tools"); do command -v "$t" >/dev/null 2>&1 || m="$m $t"; done; printf '%s' "$m"; }
m="$(missing)"
if command -v apk >/dev/null 2>&1; then
  # an Alpine leg: GNU tools in place of busybox's (no CI runner has busybox) and a bash 5 at /bin/bash for the
  # jobs CI runs on Linux only; the bash 3.2 on PATH stays the shell of the macOS jobs
  pk="bash coreutils findutils grep sed gawk tar diffutils procps"
  for t in $m; do case "$t" in node) pk="$pk nodejs" ;; *) pk="$pk $t" ;; esac; done
  echo "$leg tools: apk add $pk (inside the container)"
  apk add --no-cache $pk >/dev/null 2>&1 || { echo "LEGFAIL apk add $pk failed"; exit 1; }
  m="$(missing)"
fi
[ -z "$m" ] || { echo "LEGSKIP missing tool(s):$m - add them in the leg, e.g. wsl -u root apt-get install -y$m"; exit 3; }
echo "$leg clone: git clone -q repo.bundle src && git checkout -q --detach $sha"
git clone -q "$d/repo.bundle" "$d/src" && git -C "$d/src" checkout -q --detach "$sha" \
  || { echo "LEGFAIL git clone of the bundle failed"; exit 1; }
# a skipped actions/setup-node step: a leg node older than its node-version gets that major as setup-node does,
# the nodejs.org build, checked against the release's SHASUMS256.txt
nv="$(cat "$d/steps/node.version" 2>/dev/null)"
if [ -n "$nv" ]; then
  have="$(node --version 2>/dev/null)"; have="${have#v}"; have="${have%%.*}"
  case "$have" in ''|*[!0-9]*) have=0 ;; esac
  if [ "$have" -lt "$nv" ]; then
    case "$(uname -m)" in x86_64|amd64) ar=x64 ;; aarch64|arm64) ar=arm64 ;; *) ar="$(uname -m)" ;; esac
    base="https://nodejs.org/dist/latest-v$nv.x"
    echo "$leg node: v$have is older than setup-node's node-version $nv - fetching $base linux-$ar"
    sum="$(curl -fsSL "$base/SHASUMS256.txt" 2>/dev/null | grep " node-v[0-9.]*-linux-$ar\.tar\.gz\$" | head -n 1)"
    [ -n "$sum" ] && curl -fsSL "$base/${sum##* }" -o "$d/node.tgz" 2>/dev/null \
      || { echo "LEGSKIP node $nv (actions/setup-node) could not be fetched from $base - install node $nv in the leg"; exit 3; }
    got="$( { sha256sum < "$d/node.tgz" 2>/dev/null || shasum -a 256 < "$d/node.tgz"; } | cut -c1-64)"
    [ "$got" = "${sum%% *}" ] || { echo "LEGFAIL ${sum##* } does not match its SHASUMS256.txt line"; exit 1; }
    mkdir -p "$d/node" && tar -xzf "$d/node.tgz" -C "$d/node" --strip-components 1 && rm -f "$d/node.tgz" \
      || { echo "LEGFAIL could not unpack ${sum##* }"; exit 1; }
    PATH="$d/node/bin:$PATH"; export PATH
  fi
fi
# a runner has `python` beside python3 (the hooks fall through python3 -> python -> py): one that runs python3 when
# the leg's own `python` is missing or not Python 3
mkdir -p "$d/bin" "$d/bash5"
if ! python -c 'import sys; sys.exit(sys.version_info[0] != 3)' >/dev/null 2>&1 && p3="$(command -v python3)"; then
  printf '#!/bin/sh\nexec "%s" "$@"\n' "$p3" > "$d/bin/python"; chmod +x "$d/bin/python"
fi
printf '#!/bin/sh\nexec /bin/bash "$@"\n' > "$d/bash5/bash"; chmod +x "$d/bash5/bash"
export NPM_CONFIG_PREFIX="$d/npm-global"; PATH="$d/bin:$d/npm-global/bin:$PATH"; export PATH
cd "$d/src" || exit 1
bad=0; last=""
while IFS="	" read -r job n st tx; do
  if [ "$job" != "$last" ]; then   # a runner's RUNNER_TEMP: one fresh folder per job
    last="$job"; RUNNER_TEMP="$d/runner-temp/$job"; export RUNNER_TEMP; mkdir -p "$RUNNER_TEMP"
  fi
  if [ "$st" = SKIP ]; then echo "$leg $job/$n SKIP $tx"; continue; fi
  sh=bash; pth="$PATH"
  # the bash32 leg stands in for the macOS runner: a job CI runs on Linux only gets the Linux runner's bash 5
  if [ "$leg" = bash32 ] && [ -x /bin/bash ] && ! grep -qx "$job" "$d/steps/macos.jobs" 2>/dev/null; then
    sh=/bin/bash; pth="$d/bash5:$PATH"
  fi
  if PATH="$pth" "$sh" -e "$d/steps/$job.$n.sh" < /dev/null > "$d/step.log" 2>&1; then echo "$leg $job/$n ok - $tx"
  else rc=$?; echo "$leg $job/$n FAIL - $tx (exit $rc)"; tail -n 40 "$d/step.log" | sed 's/^/    /'; bad=1; fi
done < "$d/manifest"
exit "$bad"
LEG
}

run_leg() { # run_leg <leg> <work dir> - prints the step lines, then the LEG line; returns 1 on FAIL
  local leg="$1" w="$2" launcher why inner rc got want
  # the unpacked folder goes on every way out of the leg (a WSL run leaves no clone behind; docker also has --rm)
  inner='d="$(mktemp -d)" || exit 1; trap '"'"'rm -rf "$d"'"'"' EXIT; trap '"'"'exit 130'"'"' INT; trap '"'"'exit 143'"'"' TERM; trap '"'"'exit 129'"'"' HUP; tar -xf - -C "$d" && bash "$d/leg.sh" '"$leg $SHA"
  if [ "$leg" = linux ]; then
    launcher="${VULYK_CI_WSL:-wsl}"
    if ! command -v "$launcher" >/dev/null 2>&1; then
      echo "LEG linux: skipped - no wsl on PATH (Windows: wsl --install -d Ubuntu; a Linux or macOS host has no linux leg)"; return 0
    fi
    if ! "$launcher" -e true >/dev/null 2>&1; then
      echo "LEG linux: skipped - wsl has no working distro (wsl --install -d Ubuntu)"; return 0
    fi
    (cd "$w/pack" && tar -cf - .) | "$launcher" -e bash -c "$inner" > "$w/$leg.out" 2>&1
    rc=$?
  else
    launcher="${VULYK_CI_DOCKER:-docker}"
    if ! command -v "$launcher" >/dev/null 2>&1; then
      echo "LEG bash32: skipped - no docker on PATH (install Docker Desktop or docker engine)"; return 0
    fi
    if ! "$launcher" info >/dev/null 2>&1; then
      echo "LEG bash32: skipped - the docker daemon does not answer (start Docker Desktop)"; return 0
    fi
    (cd "$w/pack" && tar -cf - .) | "$launcher" run --rm -i "${VULYK_CI_IMAGE:-bash:3.2}" bash -c "$inner" > "$w/$leg.out" 2>&1
    rc=$?
  fi
  grep -v -e '^LEGSKIP ' -e '^LEGFAIL ' "$w/$leg.out"
  why="$(sed -n 's/^LEGSKIP //p' "$w/$leg.out" | head -n 1)"
  if [ "$rc" = 3 ] && [ -n "$why" ]; then echo "LEG $leg: skipped - $why"; return 0; fi
  # fail closed: every manifest line must come back as one result line, whatever the leg's exit says
  got="$(grep -cE "^$leg [^ ]+ (ok|FAIL|SKIP)( |\$)" "$w/$leg.out")"; want="$(wc -l < "$w/pack/manifest" | tr -d ' ')"
  if [ "$rc" = 0 ] && [ "$got" = "$want" ] && [ "$want" -gt 0 ]; then
    echo "LEG $leg: ok - $(grep -c "^$leg [^ ]* ok" "$w/$leg.out") step(s) ok, $(grep -c "^$leg [^ ]* SKIP" "$w/$leg.out") skipped"; return 0
  fi
  why="$(sed -n 's/^LEGFAIL //p' "$w/$leg.out" | head -n 1)"
  if [ -z "$why" ] && { [ "$got" != "$want" ] || [ "$want" = 0 ]; }; then why="$got of $want steps reported"; fi
  [ -n "$why" ] || why="$(grep -c "^$leg [^ ]* FAIL" "$w/$leg.out") step(s) failed (exit $rc)"
  echo "LEG $leg: FAIL - $why"; return 1
}

MODE=run; LEGS="linux bash32"; JOB=""; REMOTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list) MODE=list ;;
    --pushed) MODE=pushed; REMOTE="${2:-}"; [ -n "$REMOTE" ] || { echo "ci-local: --pushed needs the remote name" >&2; exit 2; }; shift ;;
    --leg) case "${2:-}" in linux|bash32) LEGS="$2" ;; *) echo "ci-local: --leg linux|bash32" >&2; exit 2 ;; esac; shift ;;
    --job) JOB="${2:-}"; [ -n "$JOB" ] || { echo "ci-local: --job needs a job name" >&2; exit 2; }; shift ;;
    *) echo "usage: bash scripts/ci-local.sh [--list] [--leg linux|bash32] [--job <name>] | --pushed <remote>" >&2; exit 2 ;;
  esac
  shift
done

if [ "$MODE" = pushed ]; then pushed "$REMOTE"; exit $?; fi

SHA="$(git rev-parse -q --verify HEAD)" || { echo "ci-local: no commit at HEAD" >&2; exit 2; }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/pack/steps"
git show "HEAD:$WF" > "$W/ci.yml" 2>/dev/null || { echo "ci-local: no $WF at HEAD" >&2; exit 2; }
: > "$W/pack/manifest"
parse "$W/ci.yml" "$W/pack/steps" || { echo "ci-local: could not read $WF" >&2; exit 2; }
if [ -n "$JOB" ]; then
  awk -F '\t' -v j="$JOB" '$1 == j' "$W/pack/steps/manifest" > "$W/pack/manifest"
  [ -s "$W/pack/manifest" ] || { echo "ci-local: no job '$JOB' in $WF" >&2; exit 2; }
else
  cp "$W/pack/steps/manifest" "$W/pack/manifest"
fi
rm -f "$W/pack/steps/manifest"

if [ "$MODE" = list ]; then
  awk -F '\t' '$1 != last { print "job " $1; last = $1 } $2 > 0 { if ($3 == "run") print "  " $1 "/" $2 " run - " $4; else print "  " $1 "/" $2 " SKIP " $4 }' "$W/pack/manifest"
  exit 0
fi

leg_script > "$W/pack/leg.sh"
printf '%s\n' "${VULYK_CI_LEG_TOOLS:-git jq python3 node npm}" > "$W/pack/tools"
git bundle create "$W/pack/repo.bundle" HEAD --branches --tags >/dev/null 2>&1 \
  || { echo "ci-local: git bundle of HEAD failed" >&2; exit 2; }
echo "ci-local: $SHA, legs: $LEGS"
status=0; : > "$W/legs"
for leg in $LEGS; do
  run_leg "$leg" "$W" > "$W/leg.lines" || status=1
  cat "$W/leg.lines"; grep '^LEG ' "$W/leg.lines" >> "$W/legs"
done
if [ "$LEGS" = "linux bash32" ] && [ -z "$JOB" ] && [ "$status" != 0 ]; then
  rm -f "$RECEIPT"; echo "ci-local: a run with a FAIL writes no receipt (an earlier one is removed)"
elif [ "$LEGS" = "linux bash32" ] && [ -z "$JOB" ]; then
  { echo "head=$SHA"; cat "$W/legs"; } > "$RECEIPT" && echo "ci-local: receipt written ($RECEIPT)"
else
  echo "ci-local: a partial run (--leg / --job) writes no receipt"
fi
exit "$status"
