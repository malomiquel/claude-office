#!/bin/sh
# Autorise le channel du plugin Claude Office sur cette machine, pour lancer
#   claude --channels plugin:office@claude-office
# sans l'avertissement des channels de développement.
# Ces réglages n'existent qu'en « managed settings » (niveau administrateur) : il faut sudo.
# Attention : allowedChannelPlugins REMPLACE la liste d'Anthropic (ex. Telegram n'y serait plus, sauf à l'ajouter).
#   sudo sh allow-channel.sh               autoriser
#   sudo sh allow-channel.sh --uninstall   retirer
set -e
case "$(uname)" in
  Darwin) DIR="/Library/Application Support/ClaudeCode" ;;
  Linux)  DIR="/etc/claude-code" ;;
  *) echo "Système non pris en charge : $(uname)"; exit 1 ;;
esac
FILE="$DIR/managed-settings.json"

if [ "$(id -u)" -ne 0 ]; then echo "Lance-le avec sudo : sudo sh $0"; exit 1; fi

if [ "$1" = "--uninstall" ]; then
  rm -f "$FILE"; rmdir "$DIR" 2>/dev/null || true
  echo "Autorisation retirée."; exit 0
fi

if [ -f "$FILE" ]; then
  echo "$FILE existe déjà : je n'écrase pas. Ajoute ces réglages à la main :"
  echo '  "channelsEnabled": true, "allowedChannelPlugins": [{ "marketplace": "claude-office", "plugin": "office" }]'
  exit 1
fi
mkdir -p "$DIR"
cat > "$FILE" <<'JSON'
{
  "channelsEnabled": true,
  "allowedChannelPlugins": [
    { "marketplace": "claude-office", "plugin": "office" }
  ]
}
JSON
chmod 644 "$FILE"
echo "OK : channel Claude Office autorisé. Relance claude."
