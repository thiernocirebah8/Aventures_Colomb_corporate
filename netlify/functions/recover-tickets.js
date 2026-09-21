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

/**
 * netlify/functions/recover-tickets.js
 *
 * "Billet perdu ?" — le client saisit son email, on lui renvoie ses billets
 * NON UTILISÉS par email, ET on les renvoie aussi directement à l'écran
 * (avec bouton de téléchargement), pour qu'il puisse le récupérer tout de
 * suite sans attendre l'email.
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
  if (!email) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, tickets: [] }) };
  }

  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tickets?email=eq.${encodeURIComponent(email)}&paiement=eq.Payé&used=eq.false&select=*,events(name,photo),ticket_tiers(name)&order=created_at.desc`,
      { headers: SUPABASE_HEADERS }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, tickets: [] }) };
    }

    const tickets = rows.map(t => ({
      evenement: t.events?.name || '',
      photo: t.events?.photo || '',
      typeBillet: t.ticket_tiers?.name || '',
      code: t.code,
      quantite: t.quantite
    }));

    const lines = rows.map(t =>
      `- ${t.events?.name || 'Événement'} — Code : ${t.code} (${t.quantite} billet(s), réf. ${t.ref})`
    ).join('\n');

    const message =
`Bonjour,

Voici tes billets non encore utilisés :

${lines}

Présente le code correspondant à l'entrée le jour J.

À bientôt !
Aventures Colomb`;

    if (process.env.EMAILJS_SERVICE_ID) {
      fetch('https://api.emailjs.com/api/v1.0/email/send', {
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
      }).catch(()=>{});
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, tickets }) };
  } catch (e) {
    console.error('Erreur recover-tickets', e);
    return { statusCode: 200, body: JSON.stringify({ ok: true, tickets: [] }) };
  }
};
