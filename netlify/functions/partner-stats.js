/**
 * netlify/functions/partner-stats.js
 *
 * Donne à un partenaire (ex: un stade sous contrat) un accès en lecture
 * seule et très limité aux statistiques de vente de SON événement, via un
 * code secret propre à cet événement (?partenaire=CODE côté site).
 *
 * Aucune donnée personnelle client n'est jamais renvoyée ici — uniquement
 * des compteurs agrégés (déjà stockés sur ticket_tiers.sold, jamais besoin
 * de lire la table "tickets" qui contient les infos clients).
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

  const code = (body.code || '').trim().toUpperCase();
  if (!code) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Code manquant' }) };
  }

  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/events?partner_access_code=eq.${encodeURIComponent(code)}&select=name,ticket_tiers(name,sold,total)`,
      { headers: SUPABASE_HEADERS }
    );
    const rows = await res.json();
    const ev = Array.isArray(rows) ? rows[0] : null;

    if (!ev) {
      return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Lien invalide ou expiré.' }) };
    }

    const tiers = (ev.ticket_tiers || []).map(t => ({ name: t.name, sold: t.sold || 0 }));
    const totalSold = tiers.reduce((s, t) => s + t.sold, 0);

    return { statusCode: 200, body: JSON.stringify({ ok: true, eventName: ev.name, totalSold, tiers }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Connexion impossible pour le moment.' }) };
  }
};
