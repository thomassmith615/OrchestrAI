#!/usr/bin/env bash
#
# Dumps a compact summary of this repository for outside review.
# Interfaces and decisions carry the signal; implementations mostly do not.
#
#   ./scripts/dump-context.sh > context.md
#
set -euo pipefail
cd "$(dirname "$0")/.."

# The interfaces everything else is built against.
CONTRACTS="src/engine/command.ts src/providers/types.ts src/workflow/steps.ts src/core/config/schema.ts"

echo "# $(node -p "require('./package.json').name+' v'+require('./package.json').version")"
echo "$(node -p "require('./package.json').description")"
echo "Branch $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"

echo -e "\n## Roadmap\n"
grep -E '^\*\*Current position|^- \[[ x]\]' docs/ROADMAP.md

echo -e "\n## Architecture\n"
sed 's/^#/###/' docs/ARCHITECTURE.md   # demote so it nests under this section

echo -e "\n## Decisions\n"
grep -h '^# ADR ' docs/adr/*.md | sed 's/^# ADR /- /'

echo -e "\n## Commands and exit codes\n"
grep -E '^\| `orch |^\| [0-9] \|' docs/CLI.md

echo -e "\n## Size\n\n\`\`\`"
for d in src/*/ tests/; do
  printf '%-14s %3s files %6s lines\n' "$d" \
    "$(find "$d" -name '*.ts' | wc -l)" "$(cat $(find "$d" -name '*.ts') | wc -l)"
done
echo '```'

echo -e "\n## Core contracts\n"
for f in $CONTRACTS; do
  echo -e "### $f\n\n\`\`\`ts"
  cat "$f"
  echo -e "\`\`\`\n"
done
