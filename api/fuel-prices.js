// Vercel Serverless Function
// Dosya yolu: /api/fuel-prices.js
// bildirim.epdk.gov.tr üzerinden HTTPS SOAP

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600"); // 1 saat cache

  const today = new Date();
  const tryDates = [];
  for (let i = 0; i <= 6; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    tryDates.push(`${dd}/${mm}/${d.getFullYear()}`);
  }

  // EPDK'nın bildirim portalı HTTPS endpoint
  const ENDPOINTS = [
    "https://bildirim.epdk.gov.tr/bildirim-portal/services/bildirimPetrolTarife",
    "https://lisansws.epdk.org.tr/services/bildirimPetrolTarife",
  ];

  for (const dateStr of tryDates) {
    for (const endpoint of ENDPOINTS) {
      try {
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:gen="http://genel.service.ws.epvys.g222.tubitak.gov.tr/">
  <soapenv:Header/>
  <soapenv:Body>
    <gen:genelSorgu>
      <sorguNo>71</sorguNo>
      <parametreler>${dateStr}</parametreler>
    </gen:genelSorgu>
  </soapenv:Body>
</soapenv:Envelope>`;

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml;charset=UTF-8",
            "SOAPAction": '""',
          },
          body,
          signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) continue;
        const xml = await response.text();

        const parsed = parseXml(xml);
        if (parsed && (parsed.benzin95 || parsed.motorin)) {
          return res.status(200).json({
            success: true,
            data: { ...parsed, tarih: dateStr, kaynak: "EPDK" },
          });
        }
      } catch (_) {}
    }
  }

  return res.status(200).json({
    success: false,
    error: "EPDK servisi yanıt vermedi. Fiyatları manuel girin.",
  });
}

function parseXml(xml) {
  const cdataMatch = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const inner = cdataMatch ? cdataMatch[1] : xml;

  const tag = "PetrolPiyasasiEnYuksekHacimliSekizFirmaninAkaryakitFiyatlari";
  const entries = [...inner.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g"))];
  if (!entries.length) return null;

  const benzin95 = [], motorin = [];

  for (const e of entries) {
    const b = e[1];
    const yakitTipi = (b.match(/<YakitTipi>(.*?)<\/YakitTipi>/) || [])[1] || "";
    const raw = (b.match(/<Fiyat>(.*?)<\/Fiyat>/) || [])[1] || "0";
    const fiyat = parseFloat(raw.replace(",", "."));
    const firma = (b.match(/<FirmaAdi>(.*?)<\/FirmaAdi>/) || [])[1] || "";
    if (fiyat <= 0) continue;
    const isShell = firma.toLowerCase().includes("shell");
    const t = yakitTipi.toLowerCase();
    if (t.includes("95") || t.includes("benzin")) benzin95.push({ fiyat, firma, isShell });
    if (t.includes("motorin") || t.includes("dizel")) motorin.push({ fiyat, firma, isShell });
  }

  const best = (list) => {
    if (!list.length) return null;
    const shell = list.find(x => x.isShell);
    if (shell) return { fiyat: shell.fiyat, firma: shell.firma };
    const avg = list.reduce((s, x) => s + x.fiyat, 0) / list.length;
    return { fiyat: Math.round(avg * 100) / 100, firma: "Ortalama (" + list.length + " firma)" };
  };

  return { benzin95: best(benzin95), motorin: best(motorin) };
}
