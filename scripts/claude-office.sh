#!/bin/sh
# Lance Claude Code relié au bureau Claude Office par le channel « office » du plugin.
# Les messages écrits dans le bureau arrivent dans cette session ; les autorisations s'affichent des deux côtés.
# Copié dans ~/.claude-office/bin/ par /office-setup (chemin stable pour un alias).
# Sans autorisation administrateur (scripts/allow-channel.sh), Claude Code refuse ce channel : utilise alors
#   claude --dangerously-load-development-channels plugin:office@claude-office   (avertissement à chaque lancement)
# Tes arguments d'abord : --channels accepte plusieurs valeurs et avalerait une consigne placée après.
exec claude "$@" --channels plugin:office@claude-office
