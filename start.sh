#!/bin/sh
# Annapurna Link - one-click local launcher for macOS and Linux.
# Local development only: real operations and real email stay disabled.
set -u
cd "$(dirname "$0")" || exit 1

echo
echo "  Annapurna Link - local development (macOS / Linux)"
echo "  Real operations and real email stay disabled. Everything runs on this computer."
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  [MISS] Node.js was not found on this computer."
  echo "         Annapurna Link needs Node.js 22 LTS, which includes npm."
  echo
  printf "  Open the official download page https://nodejs.org/en/download now? [y/N] "
  # Read the answer whenever stdin is readable: a real terminal, but also a
  # piped "y", an ssh session, or an automated wrapper. With stdin closed or
  # unreadable (e.g. </dev/null, CI), treat it as the default "no" and change
  # nothing. The 2>/dev/null keeps a closed stdin from printing an error.
  answer=""
  if read -r answer 2>/dev/null; then :; else answer=""; fi
  case "$answer" in
    y|Y|yes|YES|Yes|1)
      page="https://nodejs.org/en/download"
      if command -v open >/dev/null 2>&1; then open "$page" >/dev/null 2>&1 &
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$page" >/dev/null 2>&1 &
      fi
      echo "  The download page was opened. Install Node.js 22 LTS with npm, then run ./start.sh again."
      ;;
    *)
      echo "  No changes were made."
      echo "  Install Node.js 22 LTS (npm included) from https://nodejs.org/en/download"
      echo "  then run ./start.sh again."
      ;;
  esac
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "  [MISS] npm was not found, although Node.js is installed."
  echo "         Reinstall Node.js 22 LTS from https://nodejs.org/en/download (npm included)."
  echo "  No changes were made."
  exit 1
fi

node scripts/launch-setup.mjs "$@"
status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo "  The launcher stopped with exit code $status. Read the message above."
  echo "  Your local data in .local-data and your .env file were not deleted."
  exit "$status"
fi
echo
echo "  Annapurna Link has stopped. Run ./start.sh again to restart it."
exit 0
