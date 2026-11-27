// Consulta de textos bíblicos (Traducción del Nuevo Mundo) desde la
// Biblioteca en Línea de JW.org (wol.jw.org), bajo demanda: un solo texto
// por toque, igual que hacía la app en Base44 («primero se lee el texto
// almacenado; si falta, se consulta la Biblioteca en línea»).
// Uso: GET /api/texto?q=Juan%203%3A16
// Respuesta: { ref, text, verses: [{n, text}], url }

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

function cleanVerse(html) {
  let num = "";
  let out = html.replace(/<a[^>]*class="[^"]*\bvl\b[^"]*"[^>]*>([\s\S]*?)<\/a>/, function (_, inner) {
    num = inner.replace(/<[^>]+>/g, "").trim();
    return "";
  });
  out = out.replace(/<a[^>]*>[\s\S]*?<\/a>/g, "");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeEntities(out).replace(/\s+/g, " ").trim();
  return { n: num, text: out };
}

module.exports = async function handler(req, res) {
  const q = (req.query && req.query.q ? String(req.query.q) : "").trim();
  if (!q || q.length > 90) {
    res.status(400).json({ error: "missing_query" });
    return;
  }

  const wolUrl = "https://wol.jw.org/es/wol/l/r4/lp-s?q=" + encodeURIComponent(q);

  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 12000);
  let html;
  try {
    const r = await fetch(wolUrl, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
        "Accept-Language": "es",
      },
    });
    if (!r.ok) throw new Error("wol_status_" + r.status);
    html = await r.text();
  } catch (e) {
    clearTimeout(timer);
    res.status(502).json({ error: "wol_unreachable" });
    return;
  }
  clearTimeout(timer);

  const verses = [];
  const re = /<span[^>]*class="v"[^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const v = cleanVerse(m[1]);
    if (v.text) verses.push(v);
    if (verses.length >= 40) break;
  }

  if (!verses.length) {
    res.status(404).json({ error: "not_found", url: wolUrl });
    return;
  }

  let text = verses
    .map(function (v) {
      return verses.length > 1 && v.n ? v.n + " " + v.text : v.text;
    })
    .join(" ");
  let truncated = false;
  if (text.length > 6000) {
    text = text.slice(0, 6000);
    truncated = true;
  }

  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  res.status(200).json({ ref: q, text: text, verses: verses, truncated: truncated, url: wolUrl });
};
