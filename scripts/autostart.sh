#!/usr/bin/env bash
# Run the bot in the background on macOS: starts at login, restarts if it crashes,
# and keeps the Mac awake while it runs (caffeinate). Closing the lid still sleeps a MacBook
# unless it is on power with an external display.
#
#   npm run autostart -- install     # start now and at every login
#   npm run autostart -- uninstall   # stop and remove
#   npm run autostart -- status
#   npm run autostart -- logs        # follow the bot's output (Ctrl-C to stop watching)
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(pwd)"
LABEL="com.whatsapp-group-summarizer.bot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$DIR/logs/bot.log"
NODE="$(command -v node)"

case "${1:-status}" in
  install)
    if pgrep -f "node src/bot.js" >/dev/null && ! launchctl list "$LABEL" >/dev/null 2>&1; then
      echo "บอทกำลังรันอยู่ในเทอร์มินัล ปิดตัวนั้นก่อน (Ctrl-C) แล้วรันคำสั่งนี้ใหม่"
      exit 1
    fi
    mkdir -p "$DIR/logs" "$HOME/Library/LaunchAgents"
    cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-is</string>
    <string>$NODE</string><string>src/bot.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "✅ ติดตั้งแล้ว: บอทรันอยู่เบื้องหลัง และจะเปิดเองทุกครั้งที่ล็อกอินเข้าเครื่อง"
    echo "   ดูการทำงาน: npm run autostart -- logs"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "หยุดและถอดการเปิดอัตโนมัติแล้ว"
    ;;
  status)
    if launchctl list "$LABEL" >/dev/null 2>&1; then
      echo "เปิดอัตโนมัติ: ติดตั้งแล้ว"
      launchctl list "$LABEL" | grep -E '"PID"|LastExitStatus' || true
    else
      echo "เปิดอัตโนมัติ: ยังไม่ได้ติดตั้ง"
    fi
    pgrep -fl "node src/bot.js" || echo "ตอนนี้ไม่มีบอทรันอยู่"
    ;;
  logs)
    touch "$LOG"
    tail -n 50 -f "$LOG"
    ;;
  *)
    echo "ใช้: npm run autostart -- install | uninstall | status | logs"
    exit 1
    ;;
esac
