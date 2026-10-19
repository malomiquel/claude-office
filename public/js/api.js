// Appels POST /api/* : le serveur exige le token injecté dans la page.

const TOKEN = document.querySelector('meta[name="office-token"]').content;

export async function post(action, body) {
  const r = await fetch(`/api/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-office-token': TOKEN },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
