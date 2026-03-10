// Vercel Serverless Function — /api/fuel-prices.js
// Bigpara üzerinden EPDK akaryakıt fiyatları

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");

  try {
    const response = await fetch("https://bigpara.hurriyet.com.tr/akaryakit-fiyatlari/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();

    // Benzin 95 fiyatı
    const benzinMatch = html.match(/Kurşunsuz Benzin 95 Oktan[\s\S]{0,300}?(\d{2,3}[.,]\d{2})\s*TL/i)
      || html.match(/Benzin.*?(\d{2,3}[.,]\d{2})\s*TL/i);

    // Motorin fiyatı  
    const motorinMatch = html.match(/Motorin Litre[\s\S]{0,200}?(\d{2,3}[.,]\d{2})\s*TL/i)
      || html.match(/Motorin.*?(\d{2,3}[.,]\d{2})\s*TL/i);

    const parsePrice = (str) => {
      if (!str) return null;
      return parseFloat(str.replace(",", "."));
    };

    const benzin95 = benzinMatch ? parsePrice(benzinMatch[1]) : null;
    const motorin = motorinMatch ? parsePrice(motorinMatch[1]) : null;

    // Tarih için bugün
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const tarih = `${dd}/${mm}/${today.getFullYear()}`;

    if (benzin95 || motorin) {
      return res.status(200).json({
        success: true,
        data: {
          benzin95: benzin95 ? { fiyat: benzin95, firma: "EPDK Ortalaması" } : null,
          motorin: motorin ? { fiyat: motorin, firma: "EPDK Ortalaması" } : null,
          tarih,
          kaynak: "EPDK (Bigpara)",
        },
      });
    }

    // Bigpara başarısız olursa JSON içinde ara
    const jsonMatch = html.match(/"price"\s*:\s*"?([\d.,]+)"?/g);
    if (jsonMatch) {
      const prices = jsonMatch.map(m => parseFloat(m.match(/([\d.,]+)/)[1].replace(",", ".")))
        .filter(p => p > 30 && p < 200);
      if (prices.length >= 2) {
        return res.status(200).json({
          success: true,
          data: {
            benzin95: { fiyat: prices[0], firma: "EPDK" },
            motorin: { fiyat: prices[1], firma: "EPDK" },
            tarih,
            kaynak: "EPDK",
          },
        });
      }
    }

    throw new Error("Fiyat parse edilemedi");

  } catch (err) {
    return res.status(200).json({
      success: false,
      error: `Veri alınamadı: ${err.message}`,
    });
  }
}
