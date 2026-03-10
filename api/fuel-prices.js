// Vercel Serverless Function
// Dosya yolu: /api/fuel-prices.js

import http from "http";

function soapRequest(dateStr) {
  return new Promise((resolve, reject) => {
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

    const options = {
      hostname: "lisansws.epdk.org.tr",
      port: 80,
      path: "/services/bildirimPetrolTarife",
      method: "POST",
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        "SOAPAction": '""',
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });

    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

function parseXml(xml) {
  const cdataMatch = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (!cdataMatch) return null;
  const inner = cdataMatch[1];

  const entries = [...inner.matchAll(/<PetrolPiyasasiEnYuksekHacimliSekizFirmaninAkaryakitFiyatlari>([\s\S]*?)<\/PetrolPiyasasiEnYuksekHacimliSekizFirmaninAkaryakitFiyatlari>/g)];
  if (!entries.length) return null;

  const benzin95 = [], motorin = [];

  for (const e of entries) {
    const b = e[1];
    const yakitTipi = b.match(/<YakitTipi>(.*?)<\/YakitTipi>/)?.[1] || "";
    const fiyat = parseFloat((b.match(/<Fiyat>(.*?)<\/Fiyat>/)?.[1] || "0").replace(",", "."));
    const firma = b.match(/<FirmaAdi>(.*?)<\/FirmaAdi>/)?.[1] || "";
    if (fiyat <= 0) continue;
    const isShell = firma.toLowerCase().includes("shell");
    if (yakitTipi.includes("95") || yakitTipi.toLowerCase().includes("benzin")) benzin95.push({ fiyat, firma, isShell });
    if (yakitTipi.toLowerCase().includes("motorin") || yakitTipi.toLowerCase().includes("dizel")) motorin.push({ fiyat, firma, isShell });
  }

  const best = (list) => {
    if (!list.length) return null;
    const shell = list.find(x => x.isShell);
    if (shell) return { fiyat: shell.fiyat, firma: shell.firma };
    const avg = list.reduce((s, x) => s + x.fiyat, 0) / list.length;
    return { fiyat: Math.round(avg * 100) / 100, firma: "Ortalama" };
  };

  return { benzin95: best(benzin95), motorin: best(motorin) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const today = new Date();
  const tryDates = [];
  for (let i = 0; i <= 5; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    tryDates.push(`${dd}/${mm}/${d.getFullYear()}`);
  }

  for (const dateStr of tryDates) {
    try {
      const xml = await soapRequest(dateStr);
      const parsed = parseXml(xml);
      if (parsed && (parsed.benzin95 || parsed.motorin)) {
        return res.status(200).json({ success: true, data: { ...parsed, tarih: dateStr } });
      }
    } catch (_) {}
  }

  res.status(200).json({ success: false, error: "EPDK verisi alınamadı (son 5 gün denendi)" });
}
