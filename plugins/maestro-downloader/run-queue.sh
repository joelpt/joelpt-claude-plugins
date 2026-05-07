#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

LOCKFILE="/tmp/maestro-run-queue.lock"
if [[ -f "$LOCKFILE" ]]; then
  EXISTING_PID=$(cat "$LOCKFILE")
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "run-queue.sh already running (PID $EXISTING_PID). Exiting." >&2
    exit 1
  fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT INT TERM

LOG="/Users/joelthor/xfer/maestro/queue.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

# Safe to kill and restart at any time:
# - completed videos are skipped (completed:true in index.json)
# - partial files are overwritten by ffmpeg -y on re-run
# - run reconcile.js after a kill to backfill any disk-complete files
SLUGS=(
  "sir-billy-connolly/comedy"
  "eric-vetro/singing"
  "marco-pierre-white/delicious-vegetarian-cooking"
  "marco-pierre-white/delicious-food-cooked-simply"
  "steve-mann/dog-training"
  "gary-barlow/songwriting"
  "oliver-burkeman/time-management"
  "isabel-allende/magical-storytelling"
  "ken-follett/writing-bestselling-fiction"
  "steven-bartlett/start-and-scale-a-business"
  "jonathan-yeo/portrait-painting"
  "dr-rangan-chatterjee/a-blueprint-for-healthy-living"
  "agatha-christie/writing"
  "doreen-lawrence/finding-the-inner-strength"
  "stephanie-romiszewski/sleep-better"
  "owen-o-kane/a-life-less-anxious"
  "pierre-koffmann/classic-french-bistro-cooking"
  "mo-gawdat/happiness"
  "beata-heuman/interior-design"
  "vineet-bhatia/modern-indian-cooking"
  "richard-greene/public-speaking-and-communication"
  "marina-abramovic/the-art-of-being-present"
  "evy-poumpouras/the-art-of-influence"
  "james-nestor/the-power-of-your-breath"
  "professor-tim-spector/the-science-of-eating-well"
  "jo-malone-cbe/think-like-an-entrepreneur"
  "trinny-woodall/thriving-in-business"
  "peter-jones/toolkit-for-business-success"
)

TOTAL=${#SLUGS[@]}
DONE=0
FAILED=0

log "Queue started (${TOTAL} courses, resumable — completed videos will be skipped)."

for SLUG in "${SLUGS[@]}"; do
  log "▶ Starting ${SLUG} ($((DONE+FAILED+1))/${TOTAL})"
  if node lib/download.js "${SLUG}" >> "${LOG}" 2>&1; then
    log "✓ Completed ${SLUG}"
    DONE=$((DONE+1))
  else
    log "✗ FAILED ${SLUG}"
    FAILED=$((FAILED+1))
  fi
  node lib/reconcile.js >> "${LOG}" 2>&1 && log "  reconcile: ok"
done

log "Queue complete. ${DONE} succeeded, ${FAILED} failed."
