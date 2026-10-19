# Claude Office

Bureau en pixel art qui montre les sessions Claude Code en cours comme des employés, et permet de leur parler,
d'en recruter, de les virer et de répondre à leurs questions. Interface et commentaires en français.

## Lancer

- Le projet est un **plugin Claude Code** (`.claude-plugin/plugin.json`, nom `office`) et sa propre marketplace
  (`.claude-plugin/marketplace.json`, nom `claude-office`, `source: "./"`). Installation : README.
- Le plugin apporte ses hooks (`hooks/hooks.json`), le channel (`mcpServers` dans `plugin.json`) et les commandes
  `/office` et `/office-setup` (`commands/`). Aucune modification manuelle de `~/.claude/settings.json`.
- Démarrage : hook `SessionStart` -> `scripts/ensure-server.mjs` lance `server.mjs` détaché s'il ne répond pas sur
  `/health`, ou le relance si une autre version tourne et qu'aucun agent du bureau ne travaille. Journal :
  `~/.claude-office/server.log`.
- À la main : `node server.mjs` (Node 18+, aucune dépendance, pas de build), puis http://localhost:4747.
- Tests : `node --test` à la racine (`test/*.test.mjs`, `node:test`, données dans un `CLAUDE_OFFICE_HOME` temporaire).
- Version : `.claude-plugin/plugin.json`. L'augmenter à chaque publication : c'est ce qui relance les serveurs.
- macOS et Linux. Spécifique à l'OS : sélecteur de dossier (`osascript` / `zenity` / `kdialog`, sinon saisie à la main),
  ouverture du navigateur (`open` / `xdg-open`), managed settings (`allow-channel.sh`), port 80 (`setup-port80.sh`, macOS).

## Architecture

```
server.mjs            routes HTTP + fichiers statiques de public/
lib/config.mjs        ports, chemins, délais, TOKEN
lib/transcripts.mjs   lit ~/.claude/projects/**.jsonl -> employés (état, activité, historique)
lib/snapshot.mjs      état diffusé en SSE (/events), refresh toutes les 1,5 s
lib/live-asks.mjs     questions tenues en direct par le hook PreToolUse
lib/workers.mjs       agents pilotés par le bureau (claude -p en entrée stream-json, gardés ouverts), sélecteur Finder
lib/dismissed.mjs     agents virés (~/.claude-office/dismissed.json)
lib/breaks.mjs        pauses café données à la main (~/.claude-office/breaks.json), levées dès que le transcript rebouge
lib/permissions.mjs   sessions qui attendent ta permission (hook Notification -> /hook/notify)
lib/channels.mjs      sessions reliées par le channel « office » (channel/office-channel.mjs), rattachées par pid
lib/quota.mjs         quota 5 h / semaine (~/.claude-office/rate-limits.json, écrit par scripts/statusline-tap.mjs)
lib/uploads.mjs       fichiers joints (images, PDF, texte) dans ~/.claude-office/uploads/, passés à l'agent par chemin + --add-dir
scripts/              ensure-server, statusline-tap, claude-office.sh (lanceur avec channel), allow-channel.sh, setup-port80.sh
public/index.html     structure ; public/style.css (interface) ; public/office.css (scène) ; public/js/*.js (modules ES, sans build)
```

Côté page : `state.js` porte l'état partagé et `rerender()` ; `main.js` branche le SSE et les modules.
`office.js` dessine l'open space (un îlot par équipe : bureau du chef + petits bureaux des sous-agents ; salle de réunion pour ceux qui attendent ta réponse, coin café pour ceux en pause), `camera.js` la vue (sol infini, déplacement, zoom), `panel.js` le panneau, `ask.js` la carte de question, `hire.js` le recrutement,
`attachments.js` les fichiers joints, `markdown.js` le rendu des messages (tableaux compris), `people.js` noms et sprites,
`alerts.js` les notifications du navigateur (question / permission, seulement quand la page n'a pas le focus),
`ambiance.js` la lumière des fenêtres selon l'heure (`data-time`) et le thème clair / sombre (`data-theme`, appliqué dès le `<head>`).
Raccourcis (`main.js`) : Tab / Maj+Tab agent suivant qui t'attend, 1-9 un bureau, N recruter, M écrire, Échap fermer.

## Sources de données

- **Transcripts** : `~/.claude/projects/<projet>/<session>.jsonl`, sous-agents dans `<session>/subagents/agent-*.jsonl`
  (+ `.meta.json` avec `agentType` et `description`). Lecture incrémentale : lu une fois en entier, puis seulement
  les lignes ajoutées. Seules les 60 dernières entrées sont gardées et envoyées : pas d'historique complet (retiré à la
  demande de l'utilisateur, ne pas le remettre).
- **Données** : `~/.claude-office/` (`CLAUDE_OFFICE_HOME`) : `token`, `dismissed.json`, `breaks.json`, `hired.json`, `uploads/`,
  `rate-limits.json`, `server.log`, `bin/claude-office`. Jamais dans le dossier du plugin, qui change à chaque version.
- **Channel « office »** (préversion Claude Code) : `channel/office-channel.mjs`, serveur MCP stdio sans dépendance,
  déclaré dans `plugin.json`. Lancé par `~/.claude-office/bin/claude-office` (copie de `scripts/claude-office.sh`,
  `--channels plugin:office@claude-office`, alias `claude` posé par `/office-setup`), autorisé par les managed settings
  (macOS `/Library/Application Support/ClaudeCode/managed-settings.json`, Linux `/etc/claude-code/managed-settings.json`,
  via `scripts/allow-channel.sh`). Le nom `office@claude-office` est figé : c'est lui qui est dans les managed settings.
  Le plugin démarre dans toutes les sessions : `activated()` vérifie `--channels … office` dans la ligne de commande du
  Claude parent avant de se relier, sinon les messages du bureau se perdraient.
  Il ouvre `GET /channel/stream?cwd=&pid=` (ordres : `message`, `permission`) et poste `POST /channel/permission`.
  Rattachement : pid du process Claude (parent du channel) -> `~/.claude/sessions/<pid>.json` -> `sessionId`.
  Messages -> `notifications/claude/channel` ; autorisations -> `claude/channel/permission` (relay, première réponse
  gagne). Pour une session reliée, `/hook/permission` rend la main tout de suite (le terminal affiche la demande).
  Le channel répond en révision MCP 2025-06-18 : une révision plus récente bloque la livraison des messages.
  Dans le transcript, un message reçu par le channel est un `user` avec `isMeta: true` et le contenu
  `<channel source="plugin:office:office" …>texte</channel>` (`source="office"` avec le flag de dev) : `channelText()` le remet dans le fil (`via: 'bureau'`).
- **Autorisations en direct** : hook `PermissionRequest` (matcher vide = tous les outils) -> `POST /hook/permission`,
  tenu comme les questions (`lib/live-asks.mjs`, kind `permission`). Réponse = `hookSpecificOutput.decision.behavior`
  `allow` / `deny` (+ `message`). AskUserQuestion / ExitPlanMode y sont ignorés : ils passent par `/hook/ask`.
- **Attente de permission** : hook `Notification` (matcher `permission_prompt`) -> `POST /hook/notify`. Effacée dès
  que le transcript a un nouveau message user/assistant. Sans ce signal, une action sans résultat = commande longue (vert).
- **Sessions masquées** : une session jamais ouverte dans un terminal (que des `entrypoint: sdk-cli`) et absente de
  `~/.claude-office/hired.json` (agents lancés par le bureau) est une automatisation (ex. le hook de résumé du plugin ECC lance
  `claude -p` après chaque réponse) : elle n'apparaît pas dans l'open space.
- **Consommation** : `used` (entrée, sortie, cache lu / écrit) cumulé par session. Un message assistant est écrit en plusieurs
  lignes avec le même `message.id` et un usage qui grossit : on remplace celui du message en cours, sans l'additionner.
- **Fin d'un sous-agent** : un `tool_use` nommé `SubagentHandback` (pas un simple message de fin).
- **Interruption** (Échap) : message user `[Request interrupted by user…]` -> sous-agent `done` (il quitte le bureau),
  session principale `waiting` « interrompu ». Sans ça, un sous-agent arrêté restait « au travail » 30 min.
- **Quota** : `scripts/statusline-tap.mjs`, branché devant la barre de statut par `/office-setup`, recopie `rate_limits`
  dans `~/.claude-office/rate-limits.json` (l'ancien `~/.claude/statusline/rate-limits.json` est encore lu).
- **Questions en direct** : hook `PreToolUse` (matcher `AskUserQuestion|ExitPlanMode`) du plugin,
  qui fait un `curl` vers `http://127.0.0.1:4748/hook/ask` et attend. Réponse = `permissionDecision: "allow"`
  + `updatedInput.answers` (clé = texte de la question, multi-choix joints par des virgules). Réponse vide (204)
  = la question s'affiche dans le terminal. Bureau éteint = le hook ne fait rien.

## Pièges

- **Ne pas redémarrer le serveur pendant qu'un agent du bureau travaille** : ça tue ses process `claude -p` en plein
  travail (un message de l'utilisateur est resté sans réponse comme ça). Vérifier avant :
  `ps -eo command | grep -c "[c]laude -p --input-format"` doit valoir 0, ou `/health` doit dire `busy: false`.

- **Ne jamais reprendre (`--resume`) une session encore ouverte dans un terminal** : ça crée une 2e copie de l'agent
  qui travaille en parallèle sur la même session (c'est arrivé : deux copies ont modifié ce projet en même temps).
  `origin` vient du champ `entrypoint` du transcript (`cli` = terminal, `sdk-cli` = claude -p). Pour une session
  `terminal`, `/api/message` refuse sans `takeover: true`, envoyé seulement après « Reprendre ici » confirmé.
- Le mode d'autorisation est fixé au lancement d'un agent : `''` = pas de `--permission-mode` (réglages de
  l'utilisateur, ex. auto). Forcer `acceptEdits` bloque `gh`/`git` sans personne pour valider. Changer de mode = relance.

- **pf ne doit viser que `PF_PORT` (4749)**, jamais la page (4747) ni les hooks (4748) : pf redirige 80 -> 4749 et une connexion directe peut réutiliser
  le port client d'une ancienne connexion redirigée, puis rester bloquée en `SYN_RCVD`. Accès direct = `DIRECT_PORT` 4748.
- Les commandes Bash sandboxées de Claude Code n'atteignent pas toujours localhost : tester via Chrome,
  ou hors sandbox pour un simple `curl` local.
- Chaque `POST /api/*` exige l'en-tête `x-office-token` (injecté dans la page) ; `/hook/ask` exige `x-office-hook: 1`.
  Ces deux en-têtes empêchent un site web quelconque de piloter Claude via localhost : ne pas les retirer.
- Le texte des agents est échappé avant le rendu markdown : ne jamais insérer de HTML venant d'un transcript.
- Formats joints acceptés = ce que l'outil Read sait lire ; la liste existe deux fois (`lib/uploads.mjs` et
  `public/js/attachments.js`) : les garder synchronisées.
- Le glisser-déposer est géré au niveau de `window` dans `main.js` (cible = fenêtre de recrutement ou panneau) ;
  ne pas remettre d'écouteurs `drop` sur des sous-zones, sinon un dépôt à côté ouvre le fichier dans l'onglet.
- `--add-dir` est variadique : il doit rester le dernier argument de `claude -p`, sinon il avale la suite.
- Les sélecteurs d'état du perso ciblent `> .char` : sans ça, l'état du chef s'applique aussi à ses sous-agents.
- Le sol est le fond du viewport, recalé sur la caméra via `--cam-x/--cam-y/--cam-z` : ne pas redonner de fond
  ni de bordure à `.world`, sinon on retrouve une « fenêtre » qui se déplace au lieu d'un bureau infini.
- **Un îlot ne quitte jamais l'open space** tant que sa session est là : en réunion ou au café, son bureau reste vide
  (`.pod.away`) et le perso apparaît ailleurs (map `awayEls`). Les îlots suivent l'ordre des ids (`keepOrder`) :
  sinon les bureaux bougent quand quelqu'un part ou revient, et au rafraîchissement.
- **Marche** : quand un chef change de zone, `office.js` note la position de son perso avant de toucher au DOM, puis un
  `.walker` traverse `#world` (coordonnées monde = écran / zoom de la caméra) ; la place d'arrivée garde `.arriving`
  (perso caché) jusqu'à la fin. `className` est réécrit à chaque rendu : remettre `.arriving` tant que `walkers` a l'id.
- Les éléments du bureau sont réutilisés d'un rendu à l'autre (map `els` dans `office.js`) pour ne pas relancer
  les animations ; le panneau compare son HTML via `dataset.html` pour garder les sélections en cours.

- **Interrompre une session de terminal depuis le bureau : impossible proprement.** Un `SIGINT` ferme la session
  interactive (testé), et ni les channels ni les hooks ne savent interrompre un tour de l'extérieur. Stop ne vaut que
  pour les agents lancés par le bureau.
- `allow-channel.sh` ne remplace jamais des managed settings existants : il fusionne (Node, sauvegarde `.bak-claude-office`,
  état d'origine `.avant-claude-office`) et `--uninstall` ne retire que notre entrée. Sous sudo, passer `NODE=…`.

## Conventions

- Pas de dépendances, pas de build : Node natif côté serveur, modules ES natifs côté page.
- Textes visibles et commentaires en français, commentaires seulement pour expliquer un pourquoi non évident.
- Vérifier visuellement dans Chrome (http://localhost:4747) après une modif d'interface.
- Tester un changement de packaging sur un `CLAUDE_OFFICE_HOME` vide et d'autres ports (`PORT=5747 DIRECT_PORT=5748`).
