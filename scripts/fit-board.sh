#!/bin/bash
# Перерисовывает доску, пока калибровка не найдёт РОВНО нужное число клеток.
#
# Зачем цикл: модель рисует «примерно 24» — то 22, то 26. Проверить это можно
# только после отрисовки, поэтому проб может понадобиться несколько. На острове
# ушло три. Каждая проба ≈ 0,37 ₽.
#
#   scripts/fit-board.sh city-diorama 24 7
#   scripts/fit-board.sh wide-soft 24 9 5
set -u
NAME="$1"; NEED="${2:-24}"; COLS="${3:-7}"; ROWS="${4:-$COLS}"; TRIES="${TRIES:-5}"
cd "$(dirname "$0")/.."

for i in $(seq 1 "$TRIES"); do
  n=$(python3 scripts/calibrate-board.py --image "table-$NAME.webp" --key "tbl-$NAME" \
        --cells "$NEED" --grid "$COLS" --rows "$ROWS" 2>/dev/null \
        | grep 'найдено' | grep -o '[0-9]\+ клеток' | grep -o '[0-9]\+')
  if [ "$n" = "$NEED" ]; then
    echo "$NAME: ✅ $n из $NEED (попыток: $i)"
    exit 0
  fi
  echo "$NAME: попытка $i — нашлось $n, перерисовываю"
  node scripts/gen-illustrations.mjs --only="table-$NAME" --force --concurrency=1 >/dev/null 2>&1
done

n=$(python3 scripts/calibrate-board.py --image "table-$NAME.webp" --key "tbl-$NAME" \
      --cells "$NEED" --grid "$COLS" --rows "$ROWS" 2>/dev/null \
      | grep 'найдено' | grep -o '[0-9]\+ клеток' | grep -o '[0-9]\+')
[ "$n" = "$NEED" ] && echo "$NAME: ✅ $n из $NEED" || echo "$NAME: ⚠️ так и не совпало ($n из $NEED), стоит ровная сетка"
