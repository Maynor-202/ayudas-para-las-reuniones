// Consulta de textos bíblicos (Traducción del Nuevo Mundo) desde la
// Biblioteca en Línea de JW.org (wol.jw.org), bajo demanda: un solo texto
// por toque, igual que hacía la app en Base44 («primero se lee el texto
// almacenado; si falta, se consulta la Biblioteca en línea»).
// También devuelve el audio oficial del capítulo (servicio de medios de
// JW.org) con el segundo exacto donde empieza el versículo pedido, para
// escucharlo en streaming sin descargar ni almacenar nada en la app.
// Uso: GET /api/texto?q=Galatas%204%3A8
// Respuesta: { ref, text, verses: [{n, text}], audio: {url, start, end} | null, url }

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
  // El primer enlace (clase vl/vx/vp) es el número del versículo: se conserva como texto.
  let out = html.replace(/<a[^>]*class="[^"]*\bvl\b[^"]*"[^>]*>([\s\S]*?)<\/a>/, function (_, inner) {
    num = inner.replace(/<[^>]+>/g, "").trim();
    return "";
  });
  // Los demás enlaces son marcas de nota (+) y referencias: se eliminan con su contenido.
  out = out.replace(/<a[^>]*>[\s\S]*?<\/a>/g, "");
  // Cualquier otra etiqueta se quita conservando el texto.
  out = out.replace(/<[^>]+>/g, "");
  out = decodeEntities(out).replace(/\s+/g, " ").trim();
  return { n: num, text: out };
}

function toSeconds(t) {
  if (!t) return 0;
  const p = String(t).split(":");
  if (p.length !== 3) return 0;
  return parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseFloat(p[2]);
}

async function fetchChapterAudio(book, chapter, firstVerse, lastVerse) {
  const api =
    "https://app.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?output=json&pub=nwt&alllangs=0&langwritten=S&txtCMSLang=S&booknum=" +
    book +
    "&track=" +
    chapter +
    "&fileformat=MP3";
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 8000);
  try {
    const r = await fetch(api, { signal: ctrl.signal, headers: { "Accept-Language": "es" } });
    if (!r.ok) return null;
    const j = await r.json();
    const f = j && j.files && j.files.S && j.files.S.MP3 && j.files.S.MP3[0];
    if (!f || !f.file || !f.file.url) return null;
    let start = 0;
    let end = null;
    const markers = (f.markers && f.markers.markers) || [];
    const mStart = markers.find(function (x) { return x.verseNumber === firstVerse; });
    if (mStart) start = toSeconds(mStart.startTime);
    const mEnd = markers.find(function (x) { return x.verseNumber === lastVerse; });
    if (mEnd) end = toSeconds(mEnd.startTime) + toSeconds(mEnd.duration);
    return { url: f.file.url, start: start, end: end };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  // Cada versículo viene en un <span class="v" id="v<libro>-<cap>-<ver>-...">
  const verses = [];
  let book = null;
  let chapter = null;
  let firstVerse = null;
  let lastVerse = null;
  const re = /<span[^>]*class="v"[^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    const idm = tag.match(/id="v(\d+)-(\d+)-(\d+)-/);
    if (idm) {
      if (book === null) {
        book = parseInt(idm[1], 10);
        chapter = parseInt(idm[2], 10);
        firstVerse = parseInt(idm[3], 10);
      }
      lastVerse = parseInt(idm[3], 10);
    }
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

  let audio = null;
  if (book !== null && chapter !== null && firstVerse !== null) {
    audio = await fetchChapterAudio(book, chapter, firstVerse, lastVerse === null ? firstVerse : lastVerse);
  }

  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  res.status(200).json({ ref: q, text: text, verses: verses, truncated: truncated, audio: audio, url: wolUrl });
};
