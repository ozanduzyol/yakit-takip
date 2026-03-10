// Vercel Serverless Function — /api/fuel-prices.js
// doviz.com/{il}/{ilce}/opet → fallback: doviz.com/{il}/opet

function toSlug(str) {
  if (!str) return "";
  return str.toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/i̇/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/\s+/g, "-").trim();
}

async function scrape(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html",
      "Accept-Language": "tr-TR,tr;q=0.9",
      "Referer": "https://www.google.com/",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function parseHtml(html) {
  const parse = (regexes) => {
    for (const rx of regexes) {
      const m = html.match(rx);
      if (m) {
        const v = parseFloat(m[1].replace(",", "."));
        if (v > 0) return v;
      }
    }
    return null;
  };

  return {
    benzin: parse([
      /benzin fiyat[ıi]\s+([\d,]+)\s+lira/i,
      /benzin[^<]{0,120}?([\d]{2,3}[,\.]\d{2})/i,
    ]),
    motorin: parse([
      /motorin fiyat[ıi]\s+([\d,]+)\s+lira/i,
      /motorin[^<]{0,120}?([\d]{2,3}[,\.]\d{2})/i,
    ]),
    lpg: parse([
      /lpg fiyat[ıi]\s+([\d,]+)\s+lira/i,
      /(?:lpg|otogaz)[^<]{0,120}?([\d]{1,3}[,\.]\d{2})/i,
    ]),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");

  const il = req.query?.il || "bursa";
  const ilce = req.query?.ilce || "nilufer";
  const ilSlug = toSlug(il);
  const ilceSlug = toSlug(ilce);

  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const hh = String(today.getHours()).padStart(2, "0");
  const min = String(today.getMinutes()).padStart(2, "0");
  const ss = String(today.getSeconds()).padStart(2, "0");
  const tarih = `${dd}.${mm}.${today.getFullYear()} ${hh}:${min}:${ss}`;

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // İlçe bazlı dene, sıfır gelirse il geneline düş
  const urls = [
    { url: `https://www.doviz.com/akaryakit-fiyatlari/${ilSlug}/${ilceSlug}/shell`, label: `${cap(il)} / ${cap(ilce)} · Shell` },
    { url: `https://www.doviz.com/akaryakit-fiyatlari/${ilSlug}/shell`, label: `${cap(il)} · Shell` },
    { url: `https://www.doviz.com/akaryakit-fiyatlari/${ilSlug}`, label: `${cap(il)} Ortalaması` },
  ];

  if (req.query?.debug === "1") {
    const html = await scrape(urls[0].url).catch(e => e.message);
    const lines = typeof html === "string" ? html.split("\n").filter(l => /benzin|motorin|lpg|fiyat|lira/i.test(l)).slice(0, 20) : [html];
    return res.status(200).json({ debug: true, url: urls[0].url, lines });
  }

  for (const { url, label } of urls) {
    try {
      const html = await scrape(url);
      const { benzin, motorin, lpg } = parseHtml(html);
      if (benzin || motorin) {
        return res.status(200).json({
          success: true,
          data: {
            benzin95: benzin ? { fiyat: benzin, firma: label } : null,
            motorin: motorin ? { fiyat: motorin, firma: label } : null,
    
            tarih, il, ilce,
            kaynak: label,
          },
        });
      }
    } catch (_) {}
  }

  return res.status(200).json({ success: false, error: "Fiyat alınamadı — tüm kaynaklar denendi" });
}
