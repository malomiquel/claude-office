// Sessions qui attendent ta permission, signalées par le hook Notification de Claude Code.
// Le transcript seul ne permet pas de distinguer « attend une permission » d'une commande longue.

const waits = new Map(); // sessionId -> { ts, message }
const MAX_AGE_MS = 30 * 60_000;

// notification_type vaut « permission_prompt » ; on se rabat sur le texte si le champ manque
export function notePermission(input) {
  const isPermission = input.notification_type === 'permission_prompt' || /permission/i.test(input.message || '');
  if (!isPermission || !input.session_id) return;
  waits.set(input.session_id, { ts: Date.now(), message: String(input.message || '') });
}

// un sous-agent qui écrit après la notification : la permission (souvent demandée par lui) est réglée
export function settleIfNewer(sessionId, ts) {
  const w = waits.get(sessionId);
  if (w && ts > w.ts) waits.delete(sessionId);
}

// la permission est réglée dès que la session écrit un nouvel événement après la notification
export function permissionWait(sessionId, lastEventTs) {
  const w = waits.get(sessionId);
  if (!w) return null;
  if ((lastEventTs && lastEventTs > w.ts) || Date.now() - w.ts > MAX_AGE_MS) { waits.delete(sessionId); return null; }
  return w;
}
