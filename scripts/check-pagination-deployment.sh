#!/usr/bin/env bash

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

check_section() {
  local language_name=$1
  local index_file=$2
  local output_dir=$3
  local public_prefix=$4
  local language_code=$5
  local total_pages

  total_pages=$(sed -n 's/.*data-total-pages="\([0-9][0-9]*\)".*/\1/p' "$index_file" | head -1)
  if [[ -z "$total_pages" ]]; then
    echo "Missing pagination metadata in $index_file" >&2
    return 1
  fi

  local page_number=1
  while (( page_number <= total_pages )); do
    local page_file=$index_file
    local public_path="$public_prefix/"
    if (( page_number > 1 )); then
      page_file="$output_dir/page/$page_number/index.html"
      public_path="$public_prefix/page/$page_number/"
    fi

    if [[ ! -f "$page_file" ]]; then
      echo "$language_name pagination target is missing: $page_file" >&2
      return 1
    fi

    if ! git ls-files --error-unmatch "$page_file" >/dev/null 2>&1; then
      echo "$language_name pagination target is not tracked by Git: $page_file" >&2
      return 1
    fi

    if ! grep -Fq "name=\"site-current-language\" content=\"$language_code\"" "$page_file"; then
      echo "$language_name pagination target has stale language metadata: $page_file" >&2
      return 1
    fi

    if ! grep -Fq '/js/language-routing.js?v=' "$page_file"; then
      echo "$language_name pagination target is missing the language router: $page_file" >&2
      return 1
    fi

    if (( page_number > 1 )) && ! grep -Fq "href=\"$public_path\"" "$index_file"; then
      echo "$language_name pagination link is missing from $index_file: $public_path" >&2
      return 1
    fi

    page_number=$((page_number + 1))
  done

  echo "$language_name pagination deployment check passed: $total_pages pages are linked, generated, and tracked."
}

check_section "Chinese" "docs/post/index.html" "docs/post" "/post" "zh-cn"
check_section "English" "docs/en/post/index.html" "docs/en/post" "/en/post" "en"
