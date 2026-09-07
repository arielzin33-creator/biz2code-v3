#!/usr/bin/env bash
# ----------------------------------------------------------------------------
#  biz2code launcher — macOS and Linux.
#
#  Same behaviour as start-biz2code.bat: start both servers, wait until the web
#  server actually accepts a connection, then open the browser. Ctrl+C stops it.
#
#  Make it executable once:  chmod +x start-biz2code.sh
# ----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '  %s\n' "$*"; }
die() { printf '\n  %s\n\n' "$*" >&2; exit 1; }

printf '\n  biz2code\n  ----------------------------------------------------------\n\n'

command -v node >/dev/null 2>&1 \
  || die "Node.js is not installed or not on your PATH. Install 20+ from https://nodejs.org"

# Opening a second copy would fail on the port bind and look like a crash.
if (exec 3<>/dev/tcp/127.0.0.1/5173) 2>/dev/null; then
  say "biz2code is already running. Opening it in your browser."
  open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null || true
  exit 0
fi

if [ ! -f .env ]; then
  [ -f .env.example ] && cp .env.example .env && say "Created .env from the example."
  cat <<'EOF'

  Before the first run, open .env and fill in three values:

    DATABASE_URL   e.g. postgres://localhost:5432/biz2code
    JWT_SECRET     any long random string
    GROQ_API_KEY   free key from https://console.groq.com/keys

  Then run this script again. Setup details are in INSTALL.md.

EOF
  exit 1
fi

if [ ! -d node_modules ]; then
  say "First run — installing dependencies. This takes a minute or two."
  echo
  npm install
  echo
fi

# Safe to repeat: applied migrations are skipped. Reads .env, not the shell.
say "Preparing the database..."
if ! npm run db:init; then
  cat <<'EOF'

  The database could not be prepared. Most likely one of:
    - PostgreSQL is not running
    - the database does not exist yet   (createdb biz2code)
    - DATABASE_URL in .env is wrong

  Troubleshooting is in INSTALL.md.

EOF
  exit 1
fi
echo

# Poll the socket rather than sleeping a fixed amount: a fixed wait either opens
# a dead tab or wastes time. Gives up after 60s so a failed start leaves nothing.
(
  for _ in $(seq 1 150); do
    if (exec 3<>/dev/tcp/127.0.0.1/5173) 2>/dev/null; then
      open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null || true
      exit 0
    fi
    sleep 0.4
  done
) &

say "Starting biz2code. Your browser will open when it is ready."
say "Press Ctrl+C to stop."
echo

npm run dev
