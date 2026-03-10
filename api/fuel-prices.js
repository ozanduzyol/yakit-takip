// Vercel Serverless Function — /api/fuel-prices.js
// Kaynak: doviz.com/akaryakit-fiyatlari/bursa

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");

  try {
    const response = await fetch("https://www.doviz.com/akaryakit-fiyatlari/bursa", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Referer": "https://www.google.com/",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    if (req.query && req.query.debug === "1") {
      const lines = html.split("\n").filter(l => /benzin|motorin|lpg|otogaz|fiyat/i.test(l));
      return res.status(200).json({ debug: true, lines: lines.slice(0, 30), len: html.length });
    }

    // doviz.com: "Bursa ortalama benzin fiyatı XX,XX lira, motorin fiyatı XX,XX lira, LPG fiyatı XX,XX liradır"
    const benzinMatch = html.match(/benzin\s+fiyat[ıi]\s+([\d,\.]+)\s+lira/i)
      || html.match(/benzin[^<]{0,60}?([\d]{2,3}[,\.]\d{2})/i);

    const motorinMatch = html.match(/motorin\s+fiyat[ıi]\s+([\d,\.]+)\s+lira/i)
      || html.match(/motorin[^<]{0,60}?([\d]{2,3}[,\.]\d{2})/i);

    const lpgMatch = html.match(/LPG\s+fiyat[ıi]\s+([\d,\.]+)\s+lira/i)
      || html.match(/(?:lpg|otogaz)[^<]{0,60}?([\d]{1,3}[,\.]\d{2})/i);

    const parse = (m) => m ? parseFloat(m[1].replace(",", ".")) : null;

    const benzin = parse(benzinMatch);
    const motorin = parse(motorinMatch);
    const lpg = parse(lpgMatch);

    if (!benzin && !motorin && !lpg) {
      throw new Error("Parse başarısız — ?debug=1 ile kontrol edin");
    }

    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const tarih = `${dd}/${mm}/${today.getFullYear()}`;

    return res.status(200).json({
      success: true,
      data: {
        benzin95: benzin ? { fiyat: benzin, firma: "Bursa Ortalaması" } : null,
        motorin: motorin ? { fiyat: motorin, firma: "Bursa Ortalaması" } : null,
        lpg: lpg ? { fiyat: lpg, firma: "Bursa Ortalaması" } : null,
        tarih,
        kaynak: "EPDK · Bursa",
      },
    });

  } catch (err) {
    return res.status(200).json({
      success: false,
      error: err.message.slice(0, 300),
    });
  }
}
