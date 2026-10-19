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

# Node fusionne nos réglages avec ceux déjà présents (d'autres réglages administrateur, ou d'autres channels).
# Sous sudo, node n'est souvent pas dans le PATH (nvm…) : on le cherche, ou NODE=… le donne.
NODE="${NODE:-$(command -v node 2>/dev/null || true)}"
for n in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do [ -n "$NODE" ] || { [ -x "$n" ] && NODE="$n"; }; done

OURS='{
  "channelsEnabled": true,
  "allowedChannelPlugins": [
    { "marketplace": "claude-office", "plugin": "office" }
  ]
}'

# $1 = add | remove : modifie le fichier en place (après sauvegarde) sans toucher au reste
# $FILE.avant-claude-office : le fichier tel qu'il était avant nous, pour savoir quoi rendre à la désinstallation
ORIG="$FILE.avant-claude-office"
edit() {
  cp "$FILE" "$FILE.bak-claude-office"
  [ "$1" = add ] && [ ! -f "$ORIG" ] && cp "$FILE" "$ORIG"
  "$NODE" -e '
    const fs = require("fs"); const [file, op, orig] = process.argv.slice(1);
    let before = {}; try { before = JSON.parse(fs.readFileSync(orig, "utf8")); } catch {}
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    const ours = (p) => p && p.marketplace === "claude-office" && p.plugin === "office";
    const list = (s.allowedChannelPlugins || []).filter((p) => !ours(p));
    if (op === "add") { s.channelsEnabled = true; s.allowedChannelPlugins = [...list, { marketplace: "claude-office", plugin: "office" }]; }
    else if (list.length) s.allowedChannelPlugins = list;
    else delete s.allowedChannelPlugins; // liste vide : la liste par défaut revient
    if (op === "remove" && !("channelsEnabled" in before)) delete s.channelsEnabled; // pas activé avant nous
    if (Object.keys(s).length) fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
    else fs.unlinkSync(file);
  ' "$FILE" "$1" "$ORIG"
  [ "$1" = remove ] && rm -f "$ORIG"
  return 0
}

if [ "$1" = "--uninstall" ]; then
  if [ ! -f "$FILE" ]; then echo "Rien à retirer."; exit 0; fi
  if [ "$(cat "$FILE")" = "$OURS" ]; then rm -f "$FILE" "$ORIG"; rmdir "$DIR" 2>/dev/null || true
  elif [ -n "$NODE" ]; then edit remove; rmdir "$DIR" 2>/dev/null || true
  else echo "$FILE contient d'autres réglages : retire à la main l'entrée claude-office (ou relance avec NODE=/chemin/vers/node)."; exit 1
  fi
  echo "Autorisation retirée."; exit 0
fi

if [ -f "$FILE" ]; then
  if [ -z "$NODE" ]; then
    echo "$FILE existe déjà : je n'écrase pas. Ajoute ces réglages à la main (ou relance avec NODE=/chemin/vers/node) :"
    echo '  "channelsEnabled": true, "allowedChannelPlugins": [{ "marketplace": "claude-office", "plugin": "office" }]'
    exit 1
  fi
  edit add
  echo "OK : ajouté aux réglages existants (sauvegarde : $FILE.bak-claude-office). Relance claude."; exit 0
fi
mkdir -p "$DIR"
printf '%s\n' "$OURS" > "$FILE"
chmod 644 "$FILE"
echo "OK : channel Claude Office autorisé. Relance claude."
