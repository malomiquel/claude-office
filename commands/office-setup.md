---
description: Configure les options de Claude Office (channel relié au terminal, quota, adresse sans port)
allowed-tools: Bash, Read, Edit
---

Tu aides l'utilisateur à configurer les options de **Claude Office** (dossier du plugin : `${CLAUDE_PLUGIN_ROOT}`).
Le bureau marche déjà sans rien de tout ça : chaque option est facultative.

Règles :
- Présente les options en quelques lignes, puis traite-les **une par une**, en demandant son accord avant chaque modification.
- Avant de modifier un fichier de l'utilisateur (`~/.zshrc`, `~/.bashrc`, `~/.claude/settings.json`), fais-en une copie `*.bak-claude-office`.
- **Ne lance jamais `sudo` toi-même** : donne la commande exacte et laisse l'utilisateur la taper dans son terminal.
- Vérifie d'abord que `node -v` donne 18 ou plus ; sinon explique comment installer Node.js et arrête-toi.

## 1. Channel : relier les sessions de terminal au bureau
Les messages écrits dans le bureau arrivent dans la session du terminal, et les demandes d'autorisation s'affichent des deux côtés (la première réponse compte). C'est une fonction en préversion de Claude Code, qui demande une connexion claude.ai ou une clé API Anthropic.
1. Copie le lanceur dans un chemin stable :
   `mkdir -p ~/.claude-office/bin && cp "${CLAUDE_PLUGIN_ROOT}/scripts/claude-office.sh" ~/.claude-office/bin/claude-office && chmod +x ~/.claude-office/bin/claude-office`
2. Propose d'ajouter à la fin du fichier de démarrage du shell (`~/.zshrc` si `$SHELL` finit par zsh, sinon `~/.bashrc`) :
   ```
   # Claude Office : chaque session claude est reliée au bureau. Claude sans le channel : command claude
   alias claude="$HOME/.claude-office/bin/claude-office"
   ```
   Ne l'ajoute pas s'il y est déjà.
3. Sans autorisation, Claude Code refuse ce channel. Deux choix, à expliquer :
   - **Sans avertissement** (recommandé) : l'utilisateur tape lui-même `sudo NODE="$(command -v node)" sh "${CLAUDE_PLUGIN_ROOT}/scripts/allow-channel.sh"`. Cela crée les réglages administrateur de la machine (`channelsEnabled` et `allowedChannelPlugins`), ou les ajoute à ceux qui existent déjà (sauvegarde `.bak-claude-office`) ; `--uninstall` ne retire que l'entrée du bureau. Préviens que cette liste **remplace** celle d'Anthropic (un channel officiel comme Telegram ne serait plus autorisé sans l'ajouter). Sur un compte Team ou Enterprise, c'est l'administrateur de l'organisation qui doit autoriser les channels.
   - **Avec avertissement** : remplacer `--channels` par `--dangerously-load-development-channels` dans `~/.claude-office/bin/claude-office`. Un écran de confirmation s'affiche alors à chaque lancement.
4. Dis-lui de rouvrir un terminal puis de lancer `claude` : l'îlot de sa session affiche 🔗 dans le bureau.

## 2. Quota 5 h et semaine dans le bureau
Claude Code ne donne le quota qu'à la barre de statut. On y branche un petit relais qui le recopie pour le bureau, puis laisse la barre de statut d'origine s'afficher normalement.
1. `cp "${CLAUDE_PLUGIN_ROOT}/scripts/statusline-tap.mjs" ~/.claude-office/statusline-tap.mjs`
2. Lis `statusLine` dans `~/.claude/settings.json` :
   - s'il existe une commande `C`, remplace-la par `node ~/.claude-office/statusline-tap.mjs C` (garde le reste de l'objet) ;
   - sinon, préviens que la barre de statut restera vide, et propose `{ "type": "command", "command": "node ~/.claude-office/statusline-tap.mjs" }`.
   Ne l'enveloppe pas deux fois si `statusline-tap` y est déjà.

## 3. Adresse sans port : http://office.localhost (macOS seulement)
Redirige le port 80 vers le bureau. L'utilisateur tape lui-même `sudo sh "${CLAUDE_PLUGIN_ROOT}/scripts/setup-port80.sh"` (retrait : `--uninstall`). Sur Linux, propose simplement de garder http://localhost:4747 en favori.

Termine par un récapitulatif de ce qui a été fait et de ce qu'il reste à taper lui-même.
