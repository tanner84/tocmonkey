// ─────────────────────────────────────────────────────────────────────────────
// Articles API — GET (public), POST/DELETE (admin only)
// Uses Netlify Blobs for persistent storage (free, zero config)
// ─────────────────────────────────────────────────────────────────────────────

const { getStore } = require("@netlify/blobs");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "tocmonkey2025";
const BLOB_KEY = "articles";

function checkAuth(event) {
  const auth = event.headers["x-admin-password"] || "";
  return auth === (process.env.ADMIN_PASSWORD || "tocmonkey2025");
}

const DEFAULT_ARTICLES = [
  {
    id: 1,
    title: "The Coming Drone War: How Autonomous Systems Are Reshaping the Battlefield",
    author: "Phillips O'Brien",
    publication: "Phillips's Newsletter",
    date: "Mar 4, 2025",
    blurb: "A deep look at how loitering munitions and AI-guided platforms are changing force-on-force engagements — and why Western doctrine hasn't caught up.",
    url: "https://substack.com",
    tags: ["Drones", "Doctrine"],
  },
  {
    id: 2,
    title: "Why Russia's Manpower Problem Is Worse Than the Numbers Show",
    author: "Rob Lee",
    publication: "FPRI",
    date: "Feb 28, 2025",
    blurb: "Loss rates, replacement battalion quality, and the institutional knowledge gap created by three years of attritional warfare.",
    url: "https://substack.com",
    tags: ["Russia", "Order of Battle"],
  },
  {
    id: 3,
    title: "Red Sea Chokepoint: Economic Warfare by Proxy",
    author: "Craig Singleton",
    publication: "FDD",
    date: "Feb 20, 2025",
    blurb: "Houthi interdiction operations have diverted ~20% of global container traffic. Economic coercion through a non-state actor at scale.",
    url: "https://substack.com",
    tags: ["Naval", "Houthis", "Economics"],
  },
];

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
    // Articles
    try {
      const raw = await store.get(BLOB_KEY);
      const articles = raw ? JSON.parse(raw) : DEFAULT_ARTICLES;
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(articles),
      };
    } catch (e) {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(DEFAULT_ARTICLES) };
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
      let articles;
      if (body.articles) {
        articles = body.articles;
      } else if (body.article) {
        const raw = await store.get(BLOB_KEY).catch(() => null);
        articles = raw ? JSON.parse(raw) : [...DEFAULT_ARTICLES];
        const newArticle = { ...body.article, id: Date.now() };
        articles.unshift(newArticle);
      } else {
        return { statusCode: 400, body: JSON.stringify({ error: "Bad request" }) };
      }
      await store.set(BLOB_KEY, JSON.stringify(articles));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(articles),
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
      const raw = await store.get(BLOB_KEY).catch(() => null);
      let articles = raw ? JSON.parse(raw) : [...DEFAULT_ARTICLES];
      articles = articles.filter(a => a.id !== body.id);
      await store.set(BLOB_KEY, JSON.stringify(articles));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(articles),
      };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, body: "Method not allowed" };
};
