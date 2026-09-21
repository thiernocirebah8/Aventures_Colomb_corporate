/**
 * netlify/functions/cleanup-pending-tickets.js
 *
 * Fonction PLANIFIÉE (s'exécute toute seule, personne n'a besoin de l'appeler).
 * Toutes les 15 minutes, libère les billets réservés dont le paiement n'a
 * jamais abouti depuis plus de 20 minutes (client qui abandonne, connexion
 * coupée, etc.), pour que le stock ne reste jamais bloqué inutilement.
 *
 * ⚠️ Pour que cette planification fonctionne, ajoute ces lignes dans ton
 * fichier netlify.toml à la racine du projet (ne touche à rien d'autre dedans) :
 *
 *   [functions."cleanup-pending-tickets"]
 *     schedule = "*\/15 * * * *"
 *
 * Variables d'environnement Netlify nécessaires :
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

exports.handler = async () => {
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/cleanup_stale_tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ p_older_than_minutes: 20 })
    });
    const data = await res.json();
    console.log('cleanup-pending-tickets:', data);
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    console.error('cleanup-pending-tickets error', e);
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
};
