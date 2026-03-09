// ─────────────────────────────────────────────────────────────────────────────
// Articles API — GET (public), POST/DELETE (admin only)
// Uses Netlify Blobs for persistent storage (free, zero config)
// ─────────────────────────────────────────────────────────────────────────────

const { getStore } = require("@netlify/blobs");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "tocmonkey2025";
const COCOMS = ['EUCOM', 'CENTCOM', 'INDOPACOM', 'AFRICOM', 'SOUTHCOM', 'NORTHCOM'];
function getBlobKey(cocom) { return `articles-${cocom}`; }
function checkAuth(event) {
  const auth = event.headers["x-admin-password"] || "";
  return auth === ADMIN_PASSWORD;
}

exports.handler = async function (event, context) {
  const store = getStore("tocmonkey");
  const method = event.httpMethod;

  // ── GET ──────────────────────────────────────────────────────────────
  if (method === "GET") {
    // Org notes (admin only)
    if (event.queryStringParameters && event.queryStringParameters.type === "orgnotes") {
      if (!checkAuth(event)) return { statusCode:401, body:"[]" };
      try {
        const raw = await store.get("orgnotes").catch(()=>null);
        return { statusCode:200, headers:{"Content-Type":"application/json"}, body: raw||"[]" };
      } catch(e) { return { statusCode:200, headers:{"Content-Type":"application/json"}, body:"[]" }; }
    }
    // Pending suggestions (admin only)
    if (event.queryStringParameters && event.queryStringParameters.type === "pending") {
      if (!checkAuth(event)) return { statusCode:401, body:"[]" };
      try {
        const raw = await store.get("pending").catch(()=>null);
        return { statusCode:200, headers:{"Content-Type":"application/json"}, body: raw||"[]" };
      } catch(e) { return { statusCode:200, body:"[]" }; }
    }
    // Articles by COCOM
    const cocom = (event.queryStringParameters && event.queryStringParameters.cocom) || 'EUCOM';
    if (!COCOMS.includes(cocom)) return { statusCode: 400, body: 'Invalid COCOM' };
    try {
      const raw = await store.get(getBlobKey(cocom));
      const articles = raw ? JSON.parse(raw) : [];
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(articles),
      };
    } catch (e) {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify([]) };
    }
  }

  // ── All write ops require auth ────────────────────────────────────────
  if (!checkAuth(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  // ── POST public suggest (no auth — goes to pending queue) ───────────
  if (method === "POST" && event.queryStringParameters?.type === "suggest") {
    try {
      const body = JSON.parse(event.body || "{}");
      const raw = await store.get("pending").catch(()=>null);
      const pending = raw ? JSON.parse(raw) : [];
      pending.unshift({ ...body, id: Date.now(), submittedAt: new Date().toISOString() });
      await store.set("pending", JSON.stringify(pending.slice(0,200)));
      return { statusCode:200, headers:{"Content-Type":"application/json"}, body:JSON.stringify({ok:true}) };
    } catch(e) {
      return { statusCode:500, body:JSON.stringify({error:e.message}) };
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────
  if (method === "POST") {
    try {
      const body = JSON.parse(event.body || "{}");
      // Org note
      if (body.orgnote) {
        const raw = await store.get("orgnotes").catch(()=>null);
        const notes = raw ? JSON.parse(raw) : [];
        notes.unshift(body.orgnote);
        await store.set("orgnotes", JSON.stringify(notes.slice(0,50)));
        return { statusCode:200, headers:{"Content-Type":"application/json"}, body:JSON.stringify(notes) };
      }
      // Add article to COCOM blob
      const raw = await store.get(getBlobKey(cocom)).catch(() => null);
      let articles = raw ? JSON.parse(raw) : [];
      const newArticle = { ...body, id: Date.now().toString(), cocom };
      articles.unshift(newArticle);
      await store.set(getBlobKey(cocom), JSON.stringify(articles));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newArticle),
      };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────
  if (method === "DELETE") {
    try {
      const body = JSON.parse(event.body || "{}");
      // Org note delete
      if (body.orgnoteId) {
        const raw = await store.get("orgnotes").catch(()=>null);
        let notes = raw ? JSON.parse(raw) : [];
        notes = notes.filter(n => n.id !== body.orgnoteId);
        await store.set("orgnotes", JSON.stringify(notes));
        return { statusCode:200, headers:{"Content-Type":"application/json"}, body:JSON.stringify(notes) };
      }
      // Delete article from COCOM blob
      const raw = await store.get(getBlobKey(cocom)).catch(() => null);
      let articles = raw ? JSON.parse(raw) : [];
      articles = articles.filter(a => a.id !== body.id);
      await store.set(getBlobKey(cocom), JSON.stringify(articles));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      };
      // ── PUT (edit) ─────────────────────────────────────────────────────────
      if (method === "PUT") {
        try {
          const cocom = (event.queryStringParameters && event.queryStringParameters.cocom) || 'EUCOM';
          if (!COCOMS.includes(cocom)) return { statusCode: 400, body: 'Invalid COCOM' };
          const store = getStore("tocmonkey");
          const body = JSON.parse(event.body || "{}");
          let articles = [];
          const raw = await store.get(getBlobKey(cocom)).catch(() => null);
          articles = raw ? JSON.parse(raw) : [];
          articles = articles.map(a => a.id === body.id ? { ...a, ...body } : a);
          await store.set(getBlobKey(cocom), JSON.stringify(articles));
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          };
        } catch (e) {
          return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
        }
      }
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, body: "Method not allowed" };
};
