// Vercel Serverless Function — /api/fuel-prices.js
// Kullanım: /api/fuel-prices?il=bursa

const IL_SLUG = {
  "adana": "adana", "adıyaman": "adiyaman", "afyonkarahisar": "afyonkarahisar",
  "ağrı": "agri", "aksaray": "aksaray", "amasya": "amasya", "ankara": "ankara",
  "antalya": "antalya", "ardahan": "ardahan", "artvin": "artvin", "aydın": "aydin",
  "balıkesir": "balikesir", "bartın": "bartin", "batman": "batman", "bayburt": "bayburt",
  "bilecik": "bilecik", "bingöl": "bingol", "bitlis": "bitlis", "bolu": "bolu",
  "burdur": "burdur", "bursa": "bursa", "çanakkale": "canakkale", "çankırı": "cankiri",
  "çorum": "corum", "denizli": "denizli", "diyarbakır": "diyarbakir", "düzce": "duzce",
  "edirne": "edirne", "elazığ": "elazig", "erzincan": "erzincan", "erzurum": "erzurum",
  "eskişehir": "eskisehir", "gaziantep": "gaziantep", "giresun": "giresun",
  "gümüşhane": "gumushane", "hakkari": "hakkari", "hatay": "hatay", "ığdır": "igdir",
  "ısparta": "isparta", "istanbul": "istanbul", "izmir": "izmir", "kahramanmaraş": "kahramanmaras",
  "karabük": "karabuk", "karaman": "karaman", "kars": "kars", "kastamonu": "kastamonu",
  "kayseri": "kayseri", "kilis": "kilis", "kırıkkale": "kirikkale", "kırklareli": "kirklareli",
  "kırşehir": "kirsehir", "kocaeli": "kocaeli", "konya": "konya", "kütahya": "kutahya",
  "malatya": "malatya", "manisa": "manisa", "mardin": "mardin", "mersin": "mersin",
  "muğla": "mugla", "muş": "mus", "nevşehir": "nevsehir", "niğde": "nigde",
  "ordu": "ordu", "osmaniye": "osmaniye", "rize": "rize", "sakarya": "sakarya",
  "samsun": "samsun", "şanlıurfa": "sanliurfa", "siirt": "siirt", "sinop": "sinop",
  "şırnak": "sirnak", "sivas": "sivas", "tekirdağ": "tekirdag", "tokat": "tokat",
  "trabzon": "trabzon", "tunceli": "tunceli", "uşak": "usak", "van": "van",
  "yalova": "yalova", "yozgat": "yozgat", "zonguldak": "zonguldak"
};

function toSlug(ilAdi) {
  if (!ilAdi) return "bursa";
  const normalized = ilAdi.toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .trim();
  return IL_SLUG[ilAdi.toLowerCase()] || normalized;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");

  const il = req.query?.il || "bursa";
  const slug = toSlug(il);

  try {
    const response = await fetch(`https://www.doviz.com/akaryakit-fiyatlari/${slug}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Referer": "https://www.google.com/",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    if (req.query?.debug === "1") {
      const lines = html.split("\n").filter(l => /benzin|motorin|lpg|otogaz|fiyat/i.test(l));
      return res.status(200).json({ debug: true, slug, lines: lines.slice(0, 30) });
    }

    const parse = (regexes) => {
      for (const r of regexes) {
        const m = html.match(r);
        if (m) return parseFloat(m[1].replace(",", "."));
      }
      return null;
    };

    const benzin = parse([
      /benzin\s+fiyat[ıi]\s+([\d,\.]+)\s+lira/i,
      /benzin[^<]{0,80}?([\d]{2,3}[,\.]\d{2})/i,
    ]);
    const motorin = parse([
      /motorin\s+fiyat[ıi]\s+([\d,\.]+)\s+lira/i,
      /motorin[^<]{0,80}?([\d]{2,3}[,\.]\d{2})/i,
    ]);
    const lpg = parse([
      /lpg\s+fiyat[ıi]\s+([\d,\.]+)\s+lira/i,
      /(?:lpg|otogaz)[^<]{0,80}?([\d]{1,3}[,\.]\d{2})/i,
    ]);

    if (!benzin && !motorin && !lpg) {
      throw new Error(`Parse başarısız (${slug}) — ?debug=1 ile kontrol edin`);
    }

    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const tarih = `${dd}/${mm}/${today.getFullYear()}`;

    return res.status(200).json({
      success: true,
      data: {
        benzin95: benzin ? { fiyat: benzin, firma: `${il} Ortalaması` } : null,
        motorin: motorin ? { fiyat: motorin, firma: `${il} Ortalaması` } : null,
        lpg: lpg ? { fiyat: lpg, firma: `${il} Ortalaması` } : null,
        tarih,
        il,
        kaynak: `EPDK · ${il}`,
      },
    });

  } catch (err) {
    return res.status(200).json({ success: false, error: err.message.slice(0, 300) });
  }
}
