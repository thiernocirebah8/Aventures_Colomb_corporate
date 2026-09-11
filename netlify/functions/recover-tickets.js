/**
 * netlify/functions/recover-tickets.js
 *
 * "Billet perdu ?" — le client saisit son email, on lui renvoie par email
 * tous ses billets payés. Réponse toujours générique côté client (on ne
 * révèle jamais si l'email existe ou non, pour la confidentialité).
 *
 * Variables d'environnement Netlify nécessaires :
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   EMAILJS_SERVICE_ID / EMAILJS_TEMPLATE_ID / EMAILJS_PUBLIC_KEY
 */

const SUPABASE_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Méthode non autorisée' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Requête invalide' }) }; }

  const email = (body.email || '').trim().toLowerCase();
  // Réponse générique quoi qu'il arrive — ne jamais confirmer/infirmer l'existence de l'email.
  const genericResponse = { statusCode: 200, body: JSON.stringify({ ok: true }) };

  if (!email) return genericResponse;

  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tickets?email=eq.${encodeURIComponent(email)}&paiement=eq.Payé&select=*,events(name)&order=created_at.desc`,
      { headers: SUPABASE_HEADERS }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return genericResponse;

    const lines = rows.map(t =>
      `- ${t.events?.name || 'Événement'} — Code : ${t.code} (${t.quantite} billet(s), réf. ${t.ref})`
    ).join('\n');

    const message =
`Bonjour,

Voici les billets associés à cette adresse email :

${lines}

Présente le code correspondant à l'entrée le jour J.

À bientôt !
Aventures Colomb`;

    if (process.env.EMAILJS_SERVICE_ID) {
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: process.env.EMAILJS_SERVICE_ID,
          template_id: process.env.EMAILJS_TEMPLATE_ID,
          user_id: process.env.EMAILJS_PUBLIC_KEY,
          template_params: {
            subject: 'Tes billets — Aventures Colomb',
            message,
            to_email: email,
            client_email: email,
            client_name: ''
          }
        })
      });
    }
  } catch (e) {
    console.error('Erreur recover-tickets', e);
    // On renvoie quand même une réponse générique — jamais d'erreur explicite au client.
  }

  return genericResponse;
};
