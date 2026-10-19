# Claude Office

**Un bureau en pixel art où chaque session Claude Code est un employé.**
Tu vois qui travaille sur quoi, tu lui écris, tu réponds à ses questions et à ses demandes d'autorisation, tu recrutes de nouveaux agents… depuis une seule page.

*A pixel-art office where every Claude Code session is an employee: watch them work, message them, answer their questions and permission prompts, hire new agents. Interface in French. macOS and Linux.*

## Installation

Prérequis : [Claude Code](https://code.claude.com) et **Node.js 18+** (macOS ou Linux).

```sh
claude plugin marketplace add <owner>/claude-office
claude plugin install office@claude-office
```

Ou, depuis une session Claude Code : `/plugin install office --marketplace <owner>/claude-office`

C'est tout : le bureau démarre tout seul à l'ouverture de ta prochaine session Claude Code.
Ouvre-le avec la commande **`/office`**, ou directement sur **http://localhost:4747**.

Options facultatives (relier le terminal au bureau, quota, adresse sans port) : **`/office-setup`**, qui te guide pas à pas.

## Ce que tu vois

- **L'open space** : un îlot par session, avec le bureau du **chef** (la session) et les petits bureaux de ses **sous-agents**. Une bulle dit ce que chacun fait en direct (lit, code, terminal, web, délègue…).
- **Les couleurs** : 🟠 te pose une question · 🟡 a fini · 🔴 attend ta permission · ☕ en pause (coin café, après 10 min sans activité).
- **Le panneau d'un agent** (clic) : sa mission, son état, son historique récent (markdown, tableaux), et une zone pour lui écrire, avec des fichiers joints (images, PDF, texte).
- **En haut** : les compteurs, le quota 5 h / semaine (option), et **Recruter** pour lancer un nouvel agent dans un dossier.
- **Navigation** : glisse pour te déplacer, pince ou ⌘/Ctrl + molette pour zoomer, double-clic sur un bureau pour t'en approcher.

## Interagir avec les agents

| Situation | Ce que fait le bureau |
|---|---|
| Agent recruté depuis le bureau | Tu lui écris quand tu veux, même pendant qu'il travaille : il lit tes messages à la suite. |
| Question à choix (`AskUserQuestion`) ou plan à valider | La question s'affiche dans le bureau, tu cliques ta réponse. Sans réponse en 90 s, elle repasse dans le terminal. |
| Demande d'autorisation | **Autoriser** / **Refuser** depuis le bureau (même délai de 90 s). |
| Session ouverte dans un terminal | Visible en direct. Pour lui écrire depuis le bureau, active le **channel** (`/office-setup`). |
| Session reliée par le channel (🔗) | Tes messages écrits dans le bureau arrivent dans le terminal ; les autorisations s'affichent des deux côtés, la première réponse compte. |

Le **channel** est une fonction en préversion de Claude Code (connexion claude.ai ou clé API Anthropic). Sans autorisation administrateur, Claude Code affiche un avertissement à chaque lancement ; `/office-setup` explique les deux options.

## Confidentialité et sécurité

- Tout reste sur ta machine : le serveur n'écoute que `127.0.0.1`, et lit tes transcripts Claude Code (`~/.claude/projects`) en lecture seule.
- Les actions (écrire, recruter, répondre) exigent un jeton propre à ta machine (`~/.claude-office/token`) : un site web ne peut pas piloter tes agents.
- Données du bureau : `~/.claude-office/` (jeton, fichiers joints, agents virés, journal du serveur).

## Désinstaller

```sh
claude plugin uninstall office@claude-office
rm -rf ~/.claude-office
```
Si tu as utilisé `/office-setup` : retire l'alias `claude` de ton shell, la relance de la barre de statut dans `~/.claude/settings.json`, et lance `sudo sh scripts/allow-channel.sh --uninstall` ou `sudo sh scripts/setup-port80.sh --uninstall` si tu les avais activés.

## Développement

Aucune dépendance, pas de build : `node server.mjs`, puis http://localhost:4747. Architecture et pièges : [CLAUDE.md](CLAUDE.md).

Variables : `PORT` (4747), `DIRECT_PORT` (4748, utilisé par les hooks), `CLAUDE_OFFICE_HOME` (`~/.claude-office`), `OFFICE_WINDOW_MIN` (sessions visibles, 120 min), `OFFICE_ASK_WAIT_S` (90 s).

Licence MIT.
