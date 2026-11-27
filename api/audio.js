// Resuelve la URL de audio oficial (streaming) de una publicación de JW.org
// en el momento de la escucha, porque las direcciones del CDN llevan un
// segmento que puede cambiar: la app nunca guarda la URL fija, solo la
// publicación, el número y la pista.
// Uso: GET /api/audio?pub=mwb&issue=202611&track=4
// Respuesta: { title, url, duration }

const PUBS = { mwb: true, w: true };

module.exports = async function handler(req, res) {
  const pub = req.query && req.query.pub ? String(req.query.pub) : "";
  const issue = req.query && req.query.issue ? String(req.query.issue) : "";
  const track = req.query && req.query.track ? parseInt(String(req.query.track), 10) : NaN;

  if (!PUBS[pub] || !/^\d{6}$/.test(issue) || !Number.isInteger(track) || track < 1 || track > 400) {
    res.status(400).json({ error: "bad_params" });
    return;
  }

  const api =
    "https://app.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?output=json&alllangs=0&langwritten=S&txtCMSLang=S&fileformat=MP3&pub=" +
    pub +
    "&issue=" +
    issue +
    "00";

  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 12000);
  let j;
  try {
    const r = await fetch(api, { signal: ctrl.signal, headers: { "Accept-Language": "es" } });
    if (!r.ok) throw new Error("media_status_" + r.status);
    j = await r.json();
  } catch (e) {
    clearTimeout(timer);
    res.status(502).json({ error: "media_unreachable" });
    return;
  }
  clearTimeout(timer);

  const files = (j && j.files && j.files.S && j.files.S.MP3) || [];
  const f = files.find(function (x) { return x.track === track; });
  if (!f || !f.file || !f.file.url) {
    res.status(404).json({ error: "track_not_found" });
    return;
  }

  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  res.status(200).json({ title: f.title || "", url: f.file.url, duration: f.duration || null });
};
