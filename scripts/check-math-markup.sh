#!/usr/bin/env bash

set -euo pipefail

page="${1:-docs/post/transformer-architecture/index.html}"

if [[ ! -f "$page" ]]; then
  echo "Math markup check failed: missing generated page $page" >&2
  exit 1
fi

if ! perl -0ne '
  $invalid = 0;
  while (/\$\$(.*?)\$\$/sg) {
    if ($1 =~ /<\/?(?:em|strong)\b/i) {
      $invalid = 1;
      print STDERR "Math markup check failed: Markdown emphasis tag found inside display math.\n";
    }
  }
  exit $invalid;
' "$page"; then
  exit 1
fi

if ! perl -0ne '
  $invalid = 0;
  while (/<div class="math-display">(.*?)<\/div>/sg) {
    if ($1 =~ /</) {
      $invalid = 1;
      print STDERR "Math markup check failed: raw < found inside math-display; use \\lt to prevent HTML parsing.\n";
    }
  }
  exit $invalid;
' "$page"; then
  exit 1
fi

echo "Math markup check passed: display math is safe from Markdown and HTML parsing."
