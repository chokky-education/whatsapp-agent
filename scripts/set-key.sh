#!/usr/bin/env bash
# Asks for an API key without showing it on screen and saves it into .env.
#   bash scripts/set-key.sh            -> OPENAI_API_KEY
#   bash scripts/set-key.sh claude     -> ANTHROPIC_API_KEY
set -euo pipefail
cd "$(dirname "$0")/.."

name=OPENAI_API_KEY
[ "${1:-}" = "claude" ] && name=ANTHROPIC_API_KEY

[ -f .env ] || cp .env.example .env

read -r -s -p "วาง $name แล้วกด Enter (ตัวอักษรจะไม่แสดงบนจอ): " key
echo
key="$(printf '%s' "$key" | tr -d '[:space:]"'"'")"
if [ -z "$key" ]; then
  echo "ไม่ได้ใส่ key — ยกเลิก"
  exit 1
fi

tmp="$(mktemp)"
awk -v n="$name" -v k="$key" 'BEGIN{done=0} $0 ~ "^"n"=" {print n"="k; done=1; next} {print} END{if(!done) print n"="k}' .env > "$tmp"
mv "$tmp" .env
chmod 600 .env
echo "บันทึก $name ลงไฟล์ .env แล้ว (ยาว ${#key} ตัวอักษร)"
