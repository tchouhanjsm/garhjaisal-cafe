#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f "$ROOT_DIR/package.json" || ! -f "$ROOT_DIR/frontend/package.json" ]]; then
  echo "Error: dev:sync must run inside a FloCafe checkout." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: this directory is not a Git working tree." >&2
  exit 1
fi

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [[ -z "$UPSTREAM" || "$UPSTREAM" == "@{u}" ]]; then
  echo "Error: the current branch has no upstream remote branch." >&2
  echo "Set one with: git branch --set-upstream-to=origin/<branch>" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: local changes are present. Nothing was fetched, merged or overwritten." >&2
  echo "Commit your work or move it aside, then run npm run dev:sync again." >&2
  git status --short
  exit 1
fi

REMOTE="${UPSTREAM%%/*}"
OLD_HEAD="$(git rev-parse HEAD)"

echo "FloCafe development sync"
echo "Branch: $(git branch --show-current)"
echo "Upstream: $UPSTREAM"

git fetch --prune "$REMOTE"
git merge --ff-only "$UPSTREAM"

NEW_HEAD="$(git rev-parse HEAD)"
if [[ "$OLD_HEAD" == "$NEW_HEAD" ]]; then
  echo "Code is already up to date."
else
  echo "Updated code: ${OLD_HEAD:0:12} -> ${NEW_HEAD:0:12}"
fi

CHANGED_FILES="$(git diff --name-only "$OLD_HEAD" "$NEW_HEAD")"

ROOT_LOCK_CHANGED=false
FRONTEND_LOCK_CHANGED=false
if printf '%s\n' "$CHANGED_FILES" | grep -Fxq "package-lock.json"; then
  ROOT_LOCK_CHANGED=true
fi
if printf '%s\n' "$CHANGED_FILES" | grep -Fxq "frontend/package-lock.json"; then
  FRONTEND_LOCK_CHANGED=true
fi

if [[ "$ROOT_LOCK_CHANGED" == "true" || ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "Installing root dependencies (lockfile changed or node_modules is missing)..."
  npm ci
else
  echo "Root dependencies unchanged; skipping npm ci."
fi

if [[ "$FRONTEND_LOCK_CHANGED" == "true" || ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  echo "Installing frontend dependencies (lockfile changed or node_modules is missing)..."
  npm --prefix frontend ci
else
  echo "Frontend dependencies unchanged; skipping frontend npm ci."
fi

echo "Building and launching FloCafe development app..."
echo "The local SQLite database, backups and owner setup are not reset."
exec npm run dev
