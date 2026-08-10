/**
 * netlify/functions/notify-payment.js
 *
 * URL de notification (notify_url) appelée par CinetPay après un paiement.
 * ⚠️ On revérifie toujours le statut réel auprès de CinetPay avant d'agir —
 * ne jamais faire confiance à la notification seule (recommandation officielle
 * CinetPay contre les attaques "man in the middle").
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Méthode non autorisée' };
  }

  let transactionId;
  try {
    const params = new URLSearchParams(event.body);
    transactionId = params.get('cpm_trans_id') || JSON.parse(event.body).transaction_id;
  } catch (e) {
    return { statusCode: 400, body: 'Corps de requête invalide' };
  }
  if (!transactionId) return { statusCode: 400, body: 'transaction_id manquant' };

  // Revérification obligatoire du statut auprès de CinetPay
  const checkRes = await fetch('https://api-checkout.cinetpay.com/v2/payment/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: process.env.CINETPAY_API_KEY,
      site_id: process.env.CINETPAY_SITE_ID,
      transaction_id: transactionId
    })
  });
  const checkData = await checkRes.json();
  const status = checkData?.data?.status; // 'ACCEPTED' | 'REFUSED' | 'WAITING_FOR_CUSTOMER' ...

  if (status === 'WAITING_FOR_CUSTOMER') {
    // Paiement mobile money en attente de confirmation côté client (push USSD) :
    // CinetPay renverra une nouvelle notification une fois résolu.
    return { statusCode: 200, body: 'OK - en attente de confirmation client' };
  }

  if (status !== 'ACCEPTED') {
    await fetch(process.env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'ticket-failed', transactionId })
    });
    return { statusCode: 200, body: 'OK - paiement non accepté' };
  }

  // Paiement confirmé -> Apps Script génère le code, met à jour la feuille Tickets
  // et envoie l'e-billet par email.
  const confirmRes = await fetch(process.env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'ticket-confirm', transactionId, montantPaye: checkData.data.amount })
  });
  const confirmData = await confirmRes.json();

  if (!confirmData.ok) {
    console.error('Échec finalisation billet', confirmData);
    return { statusCode: 500, body: 'Erreur finalisation' };
  }

  return { statusCode: 200, body: 'OK' };
};
