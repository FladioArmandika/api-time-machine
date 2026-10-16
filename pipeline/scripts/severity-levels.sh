#!/usr/bin/env bash
# Regenerates config/severity-levels.txt from the installed oasdiff's rule list (see config/README.md).
set -euo pipefail
cd "$(dirname "$0")/../config"
errs=$(oasdiff checks changelog | awk '$2=="error"{print $1}')
{
  grep -E '^response-(property|body|header)-' <<<"$errs" | grep -E '(enum-value-added|any-of-added|one-of-added|list-of-types-widened|-unset)$' | sed 's/$/ WARN/'
  grep -E 'sunset' <<<"$errs" | grep -v 'removed-before-sunset' | sed 's/$/ INFO/'
} > severity-levels.txt
