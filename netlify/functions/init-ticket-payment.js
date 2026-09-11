/**
 * netlify/functions/init-ticket-payment.js
 *
 * Appelée par index.html (submitTicket) juste avant la redirection vers CinetPay.
 *
 * 1) Réserve le billet dans SUPABASE de façon transactionnelle (fonction SQL
 *    "purchase_ticket") : la ligne de stock est verrouillée pendant la
 *    réservation, donc impossible de survendre même si des centaines
 *    d'achats arrivent au même instant sur le même événement (concert).
 * 2) Si le stock est insuffisant, on arrête ici — le client ne paie jamais
 *    pour un billet qui n'existe plus.
 * 3) Sinon, on initie le paiement CinetPay (Orange Money Guinée + autres
 *    mobile money).
 * 4) On renvoie l'URL du guichet de paiement au navigateur.
 *
 * Variables d'environnement Netlify à définir :
 *   CINETPAY_API_KEY
 *   CINETPAY_SITE_ID
 *   SITE_URL                    -> ex: https://aventurescolomb.com
 *   SUPABASE_URL                -> ex: https://nkbwfnhxssbxrbiolyhv.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   -> clé secrète (Supabase > Settings > API > service_role)
 *                                  ⚠️ Jamais exposée au navigateur, uniquement ici côté serveur.
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Méthode non autorisée' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Requête invalide' }) }; }

  const {
    ref, transactionId, ticketId, tierId, eventId,
    evenement, typeBillet, quantite, total,
    prenom, nom, tel, email
  } = body;

  if (!ref || !transactionId || !ticketId || !tierId || !eventId || !quantite || !total || total <= 0) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Informations de billet incomplètes' }) };
  }

  // 1) Réservation atomique du billet dans Supabase.
  // La fonction SQL "purchase_ticket" verrouille la ligne de stock (ticket_tiers)
  // le temps de vérifier + décrémenter : deux achats simultanés sur la même
  // catégorie de billet sont traités l'un après l'autre, jamais en parallèle.
  let purchaseData;
  try {
    const purchaseRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/purchase_ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        p_ticket_id: ticketId,
        p_ref: ref,
        p_tier_id: tierId,
        p_event_id: eventId,
        p_quantite: quantite,
        p_prenom: prenom || '',
        p_nom: nom || '',
        p_tel: tel || '',
        p_email: email || '',
        p_transaction_id: transactionId
      })
    });
    purchaseData = await purchaseRes.json();
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Connexion à la base de données impossible pour le moment.' }) };
  }

  if (!purchaseData || !purchaseData.ok) {
    const isSoldOut = purchaseData && purchaseData.error === 'Stock insuffisant.';
    return {
      statusCode: isSoldOut ? 409 : 500,
      body: JSON.stringify({
        ok: false,
        error: isSoldOut
          ? 'Ce billet vient d\'être épuisé — quelqu\'un d\'autre vient de prendre la dernière place.'
          : (purchaseData?.error || 'Impossible de réserver le billet pour le moment.'),
        remaining: purchaseData?.remaining
      })
    };
  }

  // 2) Initialisation du paiement CinetPay — le billet est déjà réservé côté Supabase.
  let cpData;
  try {
    const cpRes = await fetch('https://api-checkout.cinetpay.com/v2/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: process.env.CINETPAY_API_KEY,
        site_id: process.env.CINETPAY_SITE_ID,
        transaction_id: transactionId,
        amount: total,
        currency: 'GNF',
        description: `Billet ${evenement || ''} - Aventures Colomb`,
        notify_url: `${process.env.SITE_URL}/.netlify/functions/notify-payment`,
        return_url: `${process.env.SITE_URL}/?paiement=merci&ref=${encodeURIComponent(ref)}&tx=${encodeURIComponent(transactionId)}`,
        channels: 'MOBILE_MONEY',
        customer_name: nom || 'Client',
        customer_surname: prenom || '',
        customer_email: email || 'client@aventurescolomb.com',
        customer_phone_number: tel
      })
    });
    cpData = await cpRes.json();
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Connexion au service de paiement impossible pour le moment.' }) };
  }

  if (String(cpData.code) !== '201') {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: cpData.message || 'Échec du paiement' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, paymentUrl: cpData.data.payment_url }) };
};
