#!/bin/sh
# Redirige http://office.localhost (port 80) vers le serveur sur 127.0.0.1:4747.
# À lancer une fois : sudo sh setup-port80.sh   (désinstaller : sudo sh setup-port80.sh --uninstall)
# La règle va dans l'ancre com.apple/claude-office : les règles pf d'Apple ne sont pas touchées.
set -e

LABEL=com.claude-office.port80
PLIST=/Library/LaunchDaemons/$LABEL.plist
ANCHOR=com.apple/claude-office

if [ "$(id -u)" -ne 0 ]; then echo "Lance-le avec sudo : sudo sh $0"; exit 1; fi

if [ "$1" = "--uninstall" ]; then
  launchctl bootout system/$LABEL 2>/dev/null || true
  rm -f "$PLIST"
  pfctl -a "$ANCHOR" -F all 2>/dev/null || true
  echo "Redirection retirée."
  exit 0
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>echo 'rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 80 -&gt; 127.0.0.1 port 4747' | /sbin/pfctl -a $ANCHOR -f - &amp;&amp; /sbin/pfctl -E</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF
chown root:wheel "$PLIST"
chmod 644 "$PLIST"

launchctl bootout system/$LABEL 2>/dev/null || true
launchctl bootstrap system "$PLIST"
sleep 1

if curl -s -o /dev/null -m 3 http://office.localhost/; then
  echo "OK : http://office.localhost"
else
  echo "La règle est chargée mais office.localhost ne répond pas encore. Vérifie : sudo pfctl -a $ANCHOR -s nat"
fi
