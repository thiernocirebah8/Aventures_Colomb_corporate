// netlify/functions/reserver.js
// Version SANS dépendance : pas besoin de package.json.
// Variable d'environnement Netlify requise : SUPABASE_SERVICE_ROLE_KEY (clé secrète, jamais dans le HTML).
// SUPABASE_URL est optionnelle (l'adresse de ton projet est utilisée par défaut).

const SUPABASE_URL = process.env.SUPABASE_URL || "https://nkbwfnhxssbxrbiolyhv.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Méthode non autorisée" });
  }
  if (!SERVICE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY manquante dans les variables Netlify");
    return json(500, { error: "Configuration serveur incomplète." });
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Requête invalide" });
  }

  // Anti-spam : champ caché "website" que seuls les robots remplissent
  if (data.website) return json(200, { ok: true });

  const eventId = String(data.event_id || "").trim();
  const prenom = String(data.prenom || "").trim();
  const nom = String(data.nom || "").trim();
  const tel = String(data.tel || "").trim();
  const email = String(data.email || "").trim();
  const places = Number.parseInt(data.places, 10) || 1;

  if (!eventId) return json(400, { error: "Événement manquant" });
  if (!prenom || prenom.length > 80) return json(400, { error: "Prénom invalide" });
  if (!nom || nom.length > 80) return json(400, { error: "Nom invalide" });
  if (!tel && !email) return json(400, { error: "Téléphone ou e-mail requis" });
  if (tel && !/^[0-9+\s().-]{6,20}$/.test(tel)) return json(400, { error: "Téléphone invalide" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(400, { error: "E-mail invalide" });
  if (places < 1 || places > 10) return json(400, { error: "Nombre de places invalide (1 à 10)" });

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reserver_place`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        p_event_id: eventId,
        p_prenom: prenom,
        p_nom: nom,
        p_tel: tel,
        p_email: email,
        p_places: places,
      }),
    });
  } catch (e) {
    console.error("Supabase injoignable:", e.message);
    return json(502, { error: "Service momentanément indisponible, réessaie." });
  }

  const text = await res.text();

  if (!res.ok) {
    if (text.includes("EVENT_FULL")) {
      return json(409, { error: "Désolé, il n'y a plus assez de places disponibles." });
    }
    if (text.includes("EVENT_NOT_FOUND")) {
      return json(404, { error: "Événement introuvable" });
    }
    console.error("reserver_place:", res.status, text);
    return json(500, { error: "Erreur serveur, réessaie plus tard." });
  }

  let row;
  try { row = JSON.parse(text); } catch { row = {}; }

  // On ne renvoie au navigateur que le strict nécessaire
  return json(200, { ok: true, ref: row.ref, places: row.places });
};
