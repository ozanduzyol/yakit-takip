// Vercel Serverless Function — /api/fuel-prices.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");

  try {
    const response = await fetch("https://bigpara.hurriyet.com.tr/akaryakit-fiyatlari/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
        "Referer": "https://www.google.com/",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    // Bigpara fiyat tablosundan çek
    // Örnek: "Kurşunsuz Benzin 95 Oktan Litre fiyatı 59,90TL"
    const parse = (regex) => {
      const m = html.match(regex);
      if (!m) return null;
      return parseFloat(m[1].replace(",", "."));
    };

    const benzin = parse(/Kurşunsuz Benzin 95 Oktan Litre fiyatı\s*([\d,]+)\s*TL/i)
      || parse(/Benzin 95[^<]{0,60}?([\d]{2,3}[.,]\d{2})\s*TL/i);

    const motorin = parse(/Motorin Litre fiyatı\s*([\d,]+)\s*TL/i)
      || parse(/Motorin[^<]{0,60}?([\d]{2,3}[.,]\d{2})\s*TL/i);

    const lpg = parse(/(?:Otogaz|LPG|TP Otogaz) Litre fiyatı\s*([\d,]+)\s*TL/i)
      || parse(/(?:Otogaz|LPG)[^<]{0,60}?([\d]{2,3}[.,]\d{2})\s*TL/i);

    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const tarih = `${dd}/${mm}/${today.getFullYear()}`;

    if (!benzin && !motorin && !lpg) {
      // HTML'yi loga yaz — debug için
      const snippet = html.slice(0, 3000);
      throw new Error("Parse başarısız. Snippet: " + snippet);
    }

    return res.status(200).json({
      success: true,
      data: {
        benzin95: benzin ? { fiyat: benzin, firma: "EPDK Ortalaması" } : null,
        motorin: motorin ? { fiyat: motorin, firma: "EPDK Ortalaması" } : null,
        lpg: lpg ? { fiyat: lpg, firma: "EPDK Ortalaması" } : null,
        tarih,
        kaynak: "EPDK (Bigpara)",
      },
    });

  } catch (err) {
    return res.status(200).json({
      success: false,
      error: err.message.slice(0, 200),
    });
  }
}
