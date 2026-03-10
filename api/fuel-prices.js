// Vercel Serverless Function
// Dosya yolu: /api/fuel-prices.js
// EPDK SOAP Web Servisi - sorguNo 71 = günlük en yüksek hacimli 8 firmanın fiyatları

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  try {
    // Bugünün tarihi GG/AA/YYYY formatında
    const today = new Date();
    // EPDK genellikle 1-2 gün gecikmeyle yayınlar, önceki günü dene
    const tryDates = [];
    for (let i = 0; i <= 4; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      tryDates.push(`${dd}/${mm}/${yyyy}`);
    }

    let parsed = null;
    let usedDate = null;

    for (const dateStr of tryDates) {
      const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:gen="http://genel.service.ws.epvys.g222.tubitak.gov.tr/">
  <soapenv:Header/>
  <soapenv:Body>
    <gen:genelSorgu>
      <sorguNo>71</sorguNo>
      <parametreler>${dateStr}</parametreler>
    </gen:genelSorgu>
  </soapenv:Body>
</soapenv:Envelope>`;

      const response = await fetch("http://lisansws.epdk.org.tr/services/bildirimPetrolTarife", {
        method: "POST",
        headers: {
          "Content-Type": "text/xml;charset=UTF-8",
          "SOAPAction": "",
        },
        body: soapBody,
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) continue;

      const xml = await response.text();

      // CDATA içinden XML çıkar
      const cdataMatch = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      if (!cdataMatch) continue;

      const innerXml = cdataMatch[1];

      // Benzin 95 ve Motorin fiyatlarını çek
      const entries = [...innerXml.matchAll(/<PetrolPiyasasiEnYuksekHacimliSekizFirmaninAkaryakitFiyatlari>([\s\S]*?)<\/PetrolPiyasasiEnYuksekHacimliSekizFirmaninAkaryakitFiyatlari>/g)];

      if (entries.length === 0) continue;

      // Shell veya ortalama bul
      const fiyatlar = { benzin95: [], motorin: [] };

      for (const entry of entries) {
        const block = entry[1];
        const yakitTipi = block.match(/<YakitTipi>(.*?)<\/YakitTipi>/)?.[1] || "";
        const fiyat = parseFloat(block.match(/<Fiyat>(.*?)<\/Fiyat>/)?.[1] || "0");
        const firma = block.match(/<FirmaAdi>(.*?)<\/FirmaAdi>/)?.[1] || "";

        if (fiyat <= 0) continue;

        const isShell = firma.toLowerCase().includes("shell");
        const isBenzin = yakitTipi.toLowerCase().includes("95") || yakitTipi.toLowerCase().includes("benzin");
        const isMotor = yakitTipi.toLowerCase().includes("motorin") || yakitTipi.toLowerCase().includes("dizel");

        if (isBenzin) fiyatlar.benzin95.push({ fiyat, firma, isShell });
        if (isMotor) fiyatlar.motorin.push({ fiyat, firma, isShell });
      }

      const findPrice = (list) => {
        if (list.length === 0) return null;
        const shell = list.find(x => x.isShell);
        if (shell) return { fiyat: shell.fiyat, firma: shell.firma };
        const avg = list.reduce((s, x) => s + x.fiyat, 0) / list.length;
        return { fiyat: Math.round(avg * 100) / 100, firma: "Ortalama" };
      };

      const benzin = findPrice(fiyatlar.benzin95);
      const motorin = findPrice(fiyatlar.motorin);

      if (benzin || motorin) {
        parsed = { benzin95: benzin, motorin, tarih: dateStr };
        usedDate = dateStr;
        break;
      }
    }

    if (!parsed) {
      return res.status(200).json({
        success: false,
        error: "EPDK verisi bulunamadı (son 4 gün kontrol edildi)",
      });
    }

    res.status(200).json({ success: true, data: parsed });

  } catch (err) {
    res.status(200).json({ success: false, error: err.message });
  }
}
