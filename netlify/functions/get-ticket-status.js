/**
 * netlify/functions/get-ticket-status.js
 *
 * Appelée par index.html (pollForTickets) juste après le retour de paiement
 * CinetPay, pour savoir si le billet a bien été confirmé côté Supabase et
 * récupérer le code d'entrée à afficher/télécharger.
 *
 * Variables d'environnement Netlify nécessaires :
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
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

  const { transactionId } = body;
  if (!transactionId) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'transactionId manquant' }) };
  }

  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tickets?transaction_id=eq.${encodeURIComponent(transactionId)}&select=*,events(name,photo),ticket_tiers(name)`,
      { headers: SUPABASE_HEADERS }
    );
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'introuvable', tickets: [] }) };
    }

    const status = row.paiement === 'Payé' ? 'paye' : (row.paiement === 'Échoué' ? 'echoue' : 'attente');
    const tickets = status === 'paye'
      ? [{
          evenement: row.events?.name || '',
          photo: row.events?.photo || '',
          typeBillet: row.ticket_tiers?.name || '',
          code: row.code,
          quantite: row.quantite
        }]
      : [];

    return { statusCode: 200, body: JSON.stringify({ ok: true, status, tickets }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Connexion à la base de données impossible pour le moment.' }) };
  }
};
