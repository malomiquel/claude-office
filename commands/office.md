---
description: Ouvre le bureau Claude Office dans le navigateur (et le démarre s'il ne tourne pas)
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-server.mjs" --open`

Le bureau Claude Office vient d'être ouvert dans le navigateur (adresse ci-dessus). Dis-le en une phrase à l'utilisateur, avec l'adresse, sans rien faire d'autre. Si la commande a échoué, explique que Claude Office demande Node.js 18 ou plus récent.
