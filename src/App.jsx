import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://delljhepbcevggfokcwy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbGxqaGVwYmNldmdnZm9rY3d5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODAzNDgsImV4cCI6MjA4ODU1NjM0OH0.HIgJdaZ0pk7uRNBYMuW4kkBlTlZoXcxQP74f8J_s6SU";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const FONT = "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace";

function formatNumber(val, decimals = 2) {
  if (val === null || val === undefined || val === "") return "";
  const num = parseFloat(val);
  if (isNaN(num)) return "";
  return num.toLocaleString("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function NumericInput({ value, onChange, placeholder, style }) {
  const handleChange = (e) => {
    const stripped = e.target.value.replace(/[^0-9,]/g, "");
    const parts = stripped.split(",");
    const intPart = parts[0].replace(/\./g, "");
    const decPart = parts.length > 1 ? "," + parts.slice(1).join("") : "";
    const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + decPart;
    onChange(formatted);
  };
  return <input type="text" inputMode="decimal" pattern="[0-9.,]*" placeholder={placeholder} value={value} onChange={handleChange} style={style} />;
}

const parseTR = (str) => parseFloat((str || "").replace(/\./g, "").replace(",", "."));
const toTR = (num) => {
  if (!num && num !== 0) return "";
  const [int, dec] = num.toFixed(2).split(".");
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return intFormatted + "," + dec;
};
const emptyForm = () => ({ date: new Date().toISOString().split("T")[0], km: "", liters: "", totalPrice: "" });

export default function FuelTracker() {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [shellPrice, setShellPrice] = useState({ benzin: "", motorin: "" });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showForm, setShowForm] = useState(false);
  const [receiptImage, setReceiptImage] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dateMode, setDateMode] = useState("picker");

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [filterMonth, setFilterMonth] = useState("all");
  const [epdkData, setEpdkData] = useState(null);
  const [userIl, setUserIl] = useState("bursa");
  const [userIlce, setUserIlce] = useState("nilufer");
  const [epdkLoading, setEpdkLoading] = useState(false);
  const [epdkError, setEpdkError] = useState(null);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    fetchEntries();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => fetchEpdk(true),
        () => fetchEpdk(false),
        { timeout: 6000 }
      );
    } else {
      fetchEpdk(false);
    }
  }, []);

  const getLocationInfo = async (lat, lon) => {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=tr`, {
      headers: { "User-Agent": "FuelTrackerApp/1.0" }
    });
    const json = await r.json();
    const il = json.address?.province || json.address?.state || json.address?.city || "bursa";
    const ilce = json.address?.county || json.address?.district || "";
    return { il, ilce };
  };

  const fetchEpdk = async (useLocation = false) => {
    setEpdkLoading(true);
    setEpdkError(null);
    try {
      let il = userIl;
      let ilce = "nilufer";
      if (useLocation) {
        const coords = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
            e => reject(e),
            { timeout: 8000 }
          );
        });
        const info = await getLocationInfo(coords.lat, coords.lon);
        il = info.il;
        ilce = info.ilce;
        setUserIl(il);
        setUserIlce(ilce);
      }
      const res = await fetch(`/api/fuel-prices?il=${encodeURIComponent(il)}&ilce=${encodeURIComponent(ilce)}`);
      const json = await res.json();
      if (json.success) {
        setEpdkData(json.data);
        if (json.data.benzin95) setShellPrice(p => ({ ...p, benzin: toTR(json.data.benzin95.fiyat) }));
        if (json.data.motorin) setShellPrice(p => ({ ...p, motorin: toTR(json.data.motorin.fiyat) }));
      } else {
        setEpdkError(json.error || "Veri alınamadı");
      }
    } catch (e) {
      setEpdkError(e.code === 1 ? "Konum izni reddedildi" : "Bağlantı hatası");
    } finally {
      setEpdkLoading(false);
    }
  };

  const fetchEntries = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("fuel_entries").select("*").order("date", { ascending: true });
    if (!error && data) {
      setEntries(data.map(e => ({
        id: e.id, date: e.date,
        km: parseFloat(e.km), liters: parseFloat(e.liters),
        totalPrice: parseFloat(e.total_price), receipt: e.receipt_url || null,
      })));
    }
    setLoading(false);
  };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setScanError(null); setScanning(true); setReceiptFile(file);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      setReceiptImage(ev.target.result);
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514", max_tokens: 1000,
            messages: [{ role: "user", content: [
              { type: "image", source: { type: "base64", media_type: file.type, data: base64 } },
              { type: "text", text: `Bu bir akaryakıt fişi. Sadece JSON döndür:\n{"date":"YYYY-MM-DD","liters":"","totalPrice":"","km":""}` }
            ]}]
          })
        });
        const data = await response.json();
        const text = data.content?.map(i => i.text || "").join("") || "";
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        setForm(p => ({
          ...p,
          date: parsed.date || p.date,
          liters: parsed.liters?.toString().replace(".", ",") || p.liters,
          totalPrice: parsed.totalPrice?.toString().replace(".", ",") || p.totalPrice,
        }));
      } catch { setScanError("Fiş okunamadı. Lütfen bilgileri manuel girin."); }
      finally { setScanning(false); }
    };
    reader.readAsDataURL(file);
  };


  const handleAdd = async () => {
    if (!form.date || !form.km || !form.liters || !form.totalPrice) return;
    setSaving(true);
    let receiptUrl = null;
    if (receiptFile) {
      const fileName = `${Date.now()}_${receiptFile.name}`;
      const { error: uploadError } = await supabase.storage.from("receipts").upload(fileName, receiptFile, { contentType: receiptFile.type });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(fileName);
        receiptUrl = urlData.publicUrl;
      }
    }
    const { error } = await supabase.from("fuel_entries").insert({
      date: form.date, km: parseTR(form.km), liters: parseTR(form.liters),
      total_price: parseTR(form.totalPrice), receipt_url: receiptUrl,
    });
    if (!error) {
      await fetchEntries();
      setForm(emptyForm()); setReceiptImage(null); setReceiptFile(null);
      setShowForm(false); setScanError(null);
    }
    setSaving(false);
  };

  const handleDelete = async (id, receipt) => {
    if (receipt) await supabase.storage.from("receipts").remove([receipt.split("/").pop()]);
    await supabase.from("fuel_entries").delete().eq("id", id);
    await fetchEntries();
  };

  const startEdit = (e) => {
    setEditingId(e.id);
    setEditForm({
      date: e.date,
      km: String(Math.round(e.km)).replace(/\B(?=(\d{3})+(?!\d))/g, "."),
      liters: toTR(e.liters),
      totalPrice: toTR(e.totalPrice),
    });
  };

  const handleEditSave = async () => {
    if (!editForm.date || !editForm.km || !editForm.liters || !editForm.totalPrice) return;
    setEditSaving(true);
    const { error } = await supabase.from("fuel_entries").update({
      date: editForm.date,
      km: parseTR(editForm.km),
      liters: parseTR(editForm.liters),
      total_price: parseTR(editForm.totalPrice),
    }).eq("id", editingId);
    if (!error) { await fetchEntries(); setEditingId(null); }
    setEditSaving(false);
  };

  const totalKm = entries.length >= 2 ? entries[entries.length - 1].km - entries[0].km : 0;
  const totalLiters = entries.reduce((s, e) => s + e.liters, 0);
  const totalSpent = entries.reduce((s, e) => s + e.totalPrice, 0);
  const avg100km = totalKm > 0 ? (totalLiters / totalKm) * 100 : 0;
  const avgPerKm = totalKm > 0 ? totalSpent / totalKm : 0;
  const avgLiterPrice = totalLiters > 0 ? totalSpent / totalLiters : 0;

  const enriched = entries.map((e, i) => {
    if (i === 0) return { ...e, consumption: null };
    const dist = e.km - entries[i - 1].km;
    return { ...e, consumption: dist > 0 ? (e.liters / dist) * 100 : null };
  });

  const inp = {
    background: "#13131f", border: "1px solid #2a2a3a", color: "#e8e4d9",
    padding: "10px 12px", width: "100%", maxWidth: "100%", fontSize: "14px", fontFamily: FONT,
    outline: "none", boxSizing: "border-box", borderRadius: "6px", display: "block",
  };

  const editInp = {
    background: "#0a0a0f", border: "1px solid #ff8c00", color: "#e8e4d9",
    padding: "6px 10px", width: "100%", maxWidth: "100%", minWidth: 0, fontSize: "13px", fontFamily: MONO,
    outline: "none", boxSizing: "border-box", borderRadius: "5px", fontWeight: "700",
    WebkitAppearance: "none", appearance: "none", display: "block",
  };

  const lbl = { fontSize: "10px", letterSpacing: "1px", color: "#555", display: "block", marginBottom: "6px", fontWeight: "600", textTransform: "uppercase", fontFamily: FONT };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e4d9", fontFamily: FONT, overflowX: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <style>{`
        input[type="date"] {
          -webkit-appearance: none;
          appearance: none;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
          display: block !important;
        }
        input, select, textarea {
          font-size: 16px !important;
        }
        * { box-sizing: border-box; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <div style={{ position: "fixed", top: "-20%", right: "-10%", width: "500px", height: "500px", background: "radial-gradient(circle, rgba(255,140,0,0.08) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: "860px", margin: "0 auto", padding: "24px 16px" }}>

        <div style={{ marginBottom: "28px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#ff8c00", marginBottom: "6px", fontWeight: "600" }}>⛽ YAKIT TAKİP</div>
          <h1 style={{ fontSize: "clamp(26px,5vw,42px)", fontWeight: "900", margin: 0, letterSpacing: "-1px", lineHeight: 1.1 }}>
            Fuel <span style={{ color: "#ff8c00" }}>Tracker</span>
          </h1>
        </div>

        <div style={{ display: "flex", gap: "4px", marginBottom: "24px", borderBottom: "1px solid #1e1e2a", justifyContent: "center" }}>
          {["dashboard", "records", "monthly", "shell"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              background: "none", border: "none", color: activeTab === tab ? "#ff8c00" : "#555",
              fontSize: "12px", letterSpacing: "1px", fontWeight: "600", textTransform: "uppercase",
              padding: "10px 14px", cursor: "pointer",
              borderBottom: activeTab === tab ? "2px solid #ff8c00" : "2px solid transparent",
              fontFamily: FONT,
            }}>
              {tab === "dashboard" ? "Panel" : tab === "records" ? "Kayıtlar" : tab === "monthly" ? "Aylık" : "Fiyatlar"}
            </button>
          ))}
        </div>

        {loading && <div style={{ textAlign: "center", padding: "48px", color: "#555", fontSize: "13px" }}>Yükleniyor...</div>}

        {/* DASHBOARD */}
        {!loading && activeTab === "dashboard" && (
          <div>
            {entries.length < 2 && (
              <div style={{ background: "#0f0f1a", border: "1px dashed #2a2a3a", borderRadius: "10px", padding: "32px", textAlign: "center", marginBottom: "20px" }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>⛽</div>
                <div style={{ color: "#555", fontSize: "13px" }}>İstatistikler için en az 2 kayıt gereklidir.</div>
              </div>
            )}
            {entries.length >= 2 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "8px", marginBottom: "8px" }}>
                {[
                  { label: "100 km Tüketim", value: `${formatNumber(avg100km)} L`, unit: "/ 100 km" },
                  { label: "Km Maliyeti", value: `${formatNumber(avgPerKm)} ₺`, unit: "/ km" },
                  { label: "Litre Fiyatı", value: `${formatNumber(avgLiterPrice)} ₺`, unit: "/ L ort." },
                ].map(s => (
                  <div key={s.label} style={{ background: "#0f0f1a", padding: "20px 16px", borderRadius: "10px", borderLeft: "3px solid #ff8c00" }}>
                    <div style={{ fontSize: "10px", fontWeight: "600", color: "#666", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
                    <div style={{ fontSize: "24px", fontWeight: "800", color: "#ff8c00", lineHeight: 1, fontFamily: MONO }}>{s.value}</div>
                    <div style={{ fontSize: "11px", color: "#444", marginTop: "4px" }}>{s.unit}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "8px", marginBottom: "20px" }}>
                {[
                  { label: "Toplam Km", value: `${formatNumber(totalKm, 0)} km` },
                  { label: "Toplam Yakıt", value: `${formatNumber(totalLiters)} L` },
                  { label: "Toplam Harcama", value: `${formatNumber(totalSpent)} ₺` },
                ].map(s => (
                  <div key={s.label} style={{ background: "#0f0f1a", padding: "16px", borderRadius: "10px" }}>
                    <div style={{ fontSize: "10px", fontWeight: "600", color: "#444", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
                    <div style={{ fontSize: "18px", fontWeight: "700", fontFamily: MONO }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </>)}

            <button onClick={() => { setShowForm(!showForm); setScanError(null); }} style={{
              background: showForm ? "transparent" : "#ff8c00", color: showForm ? "#ff8c00" : "#000",
              border: "1px solid #ff8c00", padding: "13px 28px", fontSize: "13px", fontWeight: "700",
              cursor: "pointer", fontFamily: FONT, display: "block", width: "100%", marginBottom: "8px", borderRadius: "8px",
            }}>
              {showForm ? "✕ İptal" : "+ Yeni Kayıt Ekle"}
            </button>

            {showForm && (
              <div style={{ background: "#0d0d18", padding: "20px", border: "1px solid #1e1e2a", borderRadius: "10px" }}>
                <div style={{ marginBottom: "18px" }}>
                  <div style={{ ...lbl, color: "#ff8c00" }}>📷 Fiş Tarat (Opsiyonel)</div>
                  <label style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", background: "#0a0a0f", border: "1px dashed #333", padding: "14px 16px", borderRadius: "8px" }}>
                    <input type="file" accept="image/*" onChange={handleReceiptUpload} style={{ display: "none" }} />
                    {scanning ? <span style={{ color: "#ff8c00", fontSize: "13px" }}>⏳ Fiş taranıyor...</span>
                      : receiptImage ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <img src={receiptImage} alt="fiş" style={{ width: "40px", height: "54px", objectFit: "cover", border: "1px solid #ff8c00", borderRadius: "4px" }} />
                          <span style={{ color: "#44ff88", fontSize: "13px" }}>✓ Fiş tarandı</span>
                        </div>
                      ) : <span style={{ color: "#555", fontSize: "13px" }}>+ Fiş fotoğrafı yükle (AI otomatik doldurur)</span>}
                  </label>
                  {scanError && <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "6px" }}>⚠ {scanError}</div>}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={lbl}>Tarih</span>
                      <button onClick={() => setDateMode(dateMode === "picker" ? "manual" : "picker")} style={{ background: "none", border: "none", color: "#ff8c00", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, padding: 0 }}>
                        {dateMode === "picker" ? "Manuel" : "Takvim"}
                      </button>
                    </div>
                    {dateMode === "picker"
                      ? <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} style={{ ...inp, borderColor: form.date ? "#ff8c00" : "#2a2a3a", colorScheme: "dark", maxWidth: "100%", display: "block" }} />
                      : <input type="text" placeholder="GG.AA.YYYY" value={form.date} onChange={e => {
                          const raw = e.target.value;
                          setForm(p => {
                            const parts = raw.split(".");
                            const iso = parts.length === 3 && parts[2].length === 4 ? `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}` : raw;
                            return { ...p, date: iso };
                          });
                        }} style={{ ...inp, borderColor: form.date ? "#ff8c00" : "#2a2a3a" }} />}
                  </div>
                  <div><label style={lbl}>Güncel Km</label><NumericInput placeholder="45.230" value={form.km} onChange={v => setForm(p => ({ ...p, km: v }))} style={{ ...inp, borderColor: form.km ? "#ff8c00" : "#2a2a3a" }} /></div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <label style={lbl}>Ödenen Toplam ₺</label>
                      {shellPrice.benzin && (
                        <span style={{ fontSize: "10px", color: "#ff8c00", fontWeight: "600" }}>
                          Shell 95: {formatNumber(parseTR(shellPrice.benzin))} ₺/L
                        </span>
                      )}
                    </div>
                    <NumericInput placeholder="1.250,00" value={form.totalPrice} onChange={v => setForm(p => ({ ...p, totalPrice: v }))} style={{ ...inp, borderColor: form.totalPrice ? "#ff8c00" : "#2a2a3a" }} />
                    {form.totalPrice && shellPrice.benzin && (() => {
                      const litre = parseTR(form.totalPrice) / parseTR(shellPrice.benzin);
                      return litre > 0 ? (
                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#ff8c00", fontWeight: "600" }}>
                          ≈ {formatNumber(litre)} litre
                          <button onClick={() => setForm(p => ({ ...p, liters: toTR(litre) }))}
                            style={{ marginLeft: "10px", background: "transparent", border: "1px solid #ff8c00", color: "#ff8c00", padding: "2px 8px", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "4px" }}>
                            Kullan
                          </button>
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <label style={lbl}>Alınan Litre</label>
                      {form.liters && <span style={{ fontSize: "10px", color: "#555" }}>{formatNumber(parseTR(form.liters))} L</span>}
                    </div>
                    <NumericInput placeholder="35,5" value={form.liters} onChange={v => setForm(p => ({ ...p, liters: v }))} style={{ ...inp, borderColor: form.liters ? "#ff8c00" : "#2a2a3a" }} />
                  </div>
                </div>

                <button onClick={handleAdd} disabled={saving || !form.date || !form.km || !form.liters || !form.totalPrice} style={{
                  background: (saving || !form.date || !form.km || !form.liters || !form.totalPrice) ? "#1a1a2a" : "#ff8c00",
                  color: (saving || !form.date || !form.km || !form.liters || !form.totalPrice) ? "#444" : "#000",
                  border: "none", padding: "12px 28px", fontSize: "13px", fontWeight: "700",
                  cursor: "pointer", fontFamily: FONT, borderRadius: "8px",
                }}>
                  {saving ? "Kaydediliyor..." : "Kaydet →"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* RECORDS */}
        {!loading && activeTab === "records" && (() => {
          const months = [...new Set(enriched.map(e => e.date.slice(0, 7)))].sort().reverse();
          const filteredEnriched = filterMonth === "all" ? enriched : enriched.filter(e => e.date.startsWith(filterMonth));
          const monthName = (key) => {
            const [y, m] = key.split("-");
            const names = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
            return `${names[parseInt(m)-1]} ${y}`;
          };
          return (
          <div>
            {/* Month filter */}
            {months.length > 1 && (
              <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
                <button onClick={() => setFilterMonth("all")} style={{
                  background: filterMonth === "all" ? "#ff8c00" : "transparent",
                  color: filterMonth === "all" ? "#000" : "#555",
                  border: "1px solid " + (filterMonth === "all" ? "#ff8c00" : "#2a2a3a"),
                  padding: "5px 12px", fontSize: "11px", fontWeight: "600",
                  cursor: "pointer", fontFamily: FONT, borderRadius: "20px",
                }}>Tümü</button>
                {months.map(m => (
                  <button key={m} onClick={() => setFilterMonth(m)} style={{
                    background: filterMonth === m ? "#ff8c00" : "transparent",
                    color: filterMonth === m ? "#000" : "#555",
                    border: "1px solid " + (filterMonth === m ? "#ff8c00" : "#2a2a3a"),
                    padding: "5px 12px", fontSize: "11px", fontWeight: "600",
                    cursor: "pointer", fontFamily: FONT, borderRadius: "20px",
                  }}>{monthName(m)}</button>
                ))}
              </div>
            )}
            {filteredEnriched.length === 0
              ? <div style={{ color: "#555", textAlign: "center", padding: "48px", fontSize: "14px" }}>Bu ayda kayıt yok.</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {filteredEnriched.map((e, i) => (
                    <div key={e.id} style={{ background: "#0f0f1a", borderRadius: "10px", borderLeft: i === 0 ? "3px solid #2a2a3a" : "3px solid #ff8c00", overflow: "hidden" }}>

                      {editingId === e.id ? (
                        /* ── EDIT MODE ── */
                        <div style={{ padding: "14px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                            <div>
                              <div style={{ ...lbl, marginBottom: "4px" }}>Tarih</div>
                              <input type="date" value={editForm.date} onChange={ev => setEditForm(p => ({ ...p, date: ev.target.value }))}
                                style={{ ...editInp, colorScheme: "dark", width: "100%", maxWidth: "100%", boxSizing: "border-box", display: "block", WebkitAppearance: "none", appearance: "none", minWidth: 0 }} />
                            </div>
                            <div>
                              <div style={{ ...lbl, marginBottom: "4px" }}>Km</div>
                              <NumericInput value={editForm.km} onChange={v => setEditForm(p => ({ ...p, km: v }))} placeholder="45.230" style={{ ...editInp, width: "100%", maxWidth: "100%", boxSizing: "border-box" }} />
                            </div>
                            <div>
                              <div style={{ ...lbl, marginBottom: "4px" }}>Litre</div>
                              <NumericInput value={editForm.liters} onChange={v => setEditForm(p => ({ ...p, liters: v }))} placeholder="35,5" style={{ ...editInp, width: "100%", maxWidth: "100%", boxSizing: "border-box" }} />
                            </div>
                            <div>
                              <div style={{ ...lbl, marginBottom: "4px" }}>Tutar ₺</div>
                              <NumericInput value={editForm.totalPrice} onChange={v => setEditForm(p => ({ ...p, totalPrice: v }))} placeholder="1.250,00" style={{ ...editInp, width: "100%", maxWidth: "100%", boxSizing: "border-box" }} />
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button onClick={handleEditSave} disabled={editSaving} style={{
                              background: "#ff8c00", color: "#000", border: "none", padding: "8px 20px",
                              fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px",
                            }}>{editSaving ? "Kaydediliyor..." : "Kaydet ✓"}</button>
                            <button onClick={() => setEditingId(null)} style={{
                              background: "transparent", color: "#888", border: "1px solid #2a2a3a", padding: "8px 16px",
                              fontSize: "12px", cursor: "pointer", fontFamily: FONT, borderRadius: "6px",
                            }}>İptal</button>
                          </div>
                        </div>
                      ) : (
                        /* ── VIEW MODE ── */
                        <>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 8px", flexWrap: "wrap", gap: "6px" }}>
                            <span style={{ fontSize: "13px", fontWeight: "700", color: i === 0 ? "#555" : "#e8e4d9", fontFamily: MONO }}>{e.date}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              {e.receipt && (
                                <a href={e.receipt} target="_blank" rel="noopener noreferrer">
                                  <img src={e.receipt} alt="fiş" style={{ width: "26px", height: "34px", objectFit: "cover", border: "1px solid #ff8c00", borderRadius: "3px", display: "block" }} />
                                </a>
                              )}
                              <button onClick={() => startEdit(e)} style={{ background: "none", border: "1px solid #2a2a3a", color: "#666", cursor: "pointer", padding: "5px 9px", fontSize: "11px", fontFamily: FONT, borderRadius: "5px" }}
                                onMouseEnter={ev => { ev.target.style.borderColor = "#ff8c00"; ev.target.style.color = "#ff8c00"; }}
                                onMouseLeave={ev => { ev.target.style.borderColor = "#2a2a3a"; ev.target.style.color = "#666"; }}
                              >✎</button>
                              <button onClick={() => handleDelete(e.id, e.receipt)} style={{ background: "none", border: "1px solid #2a2a3a", color: "#444", cursor: "pointer", padding: "5px 9px", fontSize: "12px", fontFamily: FONT, borderRadius: "5px" }}
                                onMouseEnter={ev => { ev.target.style.borderColor = "#ff4444"; ev.target.style.color = "#ff4444"; }}
                                onMouseLeave={ev => { ev.target.style.borderColor = "#2a2a3a"; ev.target.style.color = "#444"; }}
                              >✕</button>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: "1px solid #1a1a2a" }}>
                            {[
                              { label: "Km", val: formatNumber(e.km, 0) },
                              { label: "Litre", val: `${formatNumber(e.liters)} L` },
                              { label: "Ödeme", val: `${formatNumber(e.totalPrice)} ₺` },
                              { label: "Tüketim", val: e.consumption ? `${formatNumber(e.consumption)} L/100 km` : "—", highlight: !!e.consumption },
                            ].map((col, ci) => (
                              <div key={col.label} style={{ padding: "8px 10px", borderRight: ci < 3 ? "1px solid #1a1a2a" : "none" }}>
                                <div style={{ fontSize: "8px", fontWeight: "600", color: "#444", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>{col.label}</div>
                                <div style={{ fontSize: "11px", fontWeight: "700", color: col.highlight ? "#ff8c00" : "#c0bdb5", fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{col.val}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
            }

            {filteredEnriched.length > 0 && (() => {
                const downloadCSV = (data, filename) => {
                  const header = "Tarih,KM,Litre,Tutar (TL),Tuketim (L/100 km)";
                  const rows = data.map(e =>
                    `${e.date},${e.km},${e.liters},${e.totalPrice},${e.consumption ? e.consumption.toFixed(2) : ""}`
                  );
                  const csv = [header, ...rows].join("\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = filename;
                  a.style.display = "none";
                  document.body.appendChild(a);
                  const evt = new MouseEvent("click", { bubbles: false, cancelable: false, view: window });
                  a.dispatchEvent(evt);
                  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
                };
                const btnStyle = {
                  background: "transparent", color: "#555",
                  border: "1px solid #2a2a3a", padding: "11px 20px", fontSize: "12px",
                  fontWeight: "600", cursor: "pointer", fontFamily: FONT,
                  display: "flex", alignItems: "center", gap: "8px",
                  borderRadius: "8px", flex: 1, justifyContent: "center",
                };
                return (
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button onClick={() => downloadCSV(filteredEnriched, `fuel-tracker-${filterMonth === "all" ? "tum" : filterMonth}-${new Date().toISOString().slice(0,10)}.csv`)}
                      style={btnStyle}
                      onMouseEnter={ev => { ev.currentTarget.style.borderColor = "#ff8c00"; ev.currentTarget.style.color = "#ff8c00"; }}
                      onMouseLeave={ev => { ev.currentTarget.style.borderColor = "#2a2a3a"; ev.currentTarget.style.color = "#555"; }}
                    >↓ {filterMonth === "all" ? "CSV indir" : "Seçili ayı indir"}</button>
                    {filterMonth !== "all" && (
                      <button onClick={() => downloadCSV(enriched, `fuel-tracker-tum-${new Date().toISOString().slice(0,10)}.csv`)}
                        style={btnStyle}
                        onMouseEnter={ev => { ev.currentTarget.style.borderColor = "#ff8c00"; ev.currentTarget.style.color = "#ff8c00"; }}
                        onMouseLeave={ev => { ev.currentTarget.style.borderColor = "#2a2a3a"; ev.currentTarget.style.color = "#555"; }}
                      >↓ Tüm kayıtları indir</button>
                    )}
                  </div>
                );
              })()}
          </div>
          );
        })()}


        {/* MONTHLY */}
        {!loading && activeTab === "monthly" && (() => {
          // Group entries by YYYY-MM
          const byMonth = {};
          enriched.forEach(e => {
            const key = e.date.slice(0, 7);
            if (!byMonth[key]) byMonth[key] = { liters: 0, spent: 0, km: 0, count: 0, entries: [] };
            byMonth[key].liters += e.liters;
            byMonth[key].spent += e.totalPrice;
            byMonth[key].count += 1;
            byMonth[key].entries.push(e);
          });
          const months = Object.keys(byMonth).sort().reverse();
          const monthName = (key) => {
            const [y, m] = key.split("-");
            const names = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
            return `${names[parseInt(m)-1]} ${y}`;
          };
          return (
            <div>
              {months.length === 0
                ? <div style={{ color: "#555", textAlign: "center", padding: "48px", fontSize: "14px" }}>Henüz kayıt yok.</div>
                : <>{months.length >= 2 && (() => {
                    const chartData = [...months].reverse().map(key => {
                      const m = byMonth[key];
                      const [y, mo] = key.split("-");
                      const names = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
                      const label = `${names[parseInt(mo)-1]} ${y.slice(2)}`;
                      const sortedE = m.entries.sort((a,b) => a.date.localeCompare(b.date));
                      const monthKm = sortedE.length >= 2 ? sortedE[sortedE.length-1].km - sortedE[0].km : null;
                      const cons = monthKm > 0 ? parseFloat((m.liters / monthKm * 100).toFixed(2)) : null;
                      return { label, liters: parseFloat(m.liters.toFixed(2)), spent: parseFloat(m.spent.toFixed(2)), cons };
                    });
                    const charts = [
                      { key: "spent", label: "Aylık Harcama (₺)", color: "#ff8c00", unit: "₺" },
                      { key: "liters", label: "Aylık Yakıt (L)", color: "#44aaff", unit: "L" },
                      { key: "cons", label: "Ort. L/100 km", color: "#44ff88", unit: "L" },
                    ];
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
                        {charts.map(c => (
                          <div key={c.key} style={{ background: "#0f0f1a", borderRadius: "10px", padding: "14px", borderLeft: `3px solid ${c.color}` }}>
                            <div style={{ fontSize: "10px", fontWeight: "700", color: c.color, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>{c.label}</div>
                            <ResponsiveContainer width="100%" height={120}>
                              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2a" />
                                <XAxis dataKey="label" tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                  contentStyle={{ background: "#0a0a0f", border: "1px solid #2a2a3a", borderRadius: "6px", fontSize: "12px" }}
                                  labelStyle={{ color: "#888" }}
                                  itemStyle={{ color: c.color }}
                                  formatter={v => v != null ? [`${v} ${c.unit}`, c.label] : ["—", c.label]}
                                />
                                <Line type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={2} dot={{ fill: c.color, r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {months.map(key => {
                      const m = byMonth[key];
                      // km for month: last km - first km in that month
                      const sortedE = m.entries.sort((a,b) => a.date.localeCompare(b.date));
                      const monthKm = sortedE.length >= 2 ? sortedE[sortedE.length-1].km - sortedE[0].km : null;
                      const cons = monthKm > 0 ? (m.liters / monthKm) * 100 : null;
                      return (
                        <div key={key} style={{ background: "#0f0f1a", borderRadius: "10px", borderLeft: "3px solid #ff8c00", overflow: "hidden" }}>
                          <div style={{ padding: "12px 14px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "15px", fontWeight: "800", color: "#e8e4d9", fontFamily: MONO }}>{monthName(key)}</span>
                            <span style={{ fontSize: "11px", color: "#555", fontWeight: "500" }}>{m.count} dolum</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: "1px solid #1a1a2a" }}>
                            {[
                              { label: "Yakıt", val: `${formatNumber(m.liters)} L` },
                              { label: "Harcama", val: `${formatNumber(m.spent)} ₺` },
                              { label: "L/100 km", val: cons ? `${formatNumber(cons)} L` : "—", highlight: !!cons },
                              { label: "₺/Litre", val: m.liters > 0 ? `${formatNumber(m.spent / m.liters)} ₺` : "—" },
                            ].map((col, ci) => (
                              <div key={col.label} style={{ padding: "8px 10px", borderRight: ci < 3 ? "1px solid #1a1a2a" : "none" }}>
                                <div style={{ fontSize: "8px", fontWeight: "600", color: "#444", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>{col.label}</div>
                                <div style={{ fontSize: "11px", fontWeight: "700", color: col.highlight ? "#ff8c00" : "#c0bdb5", fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{col.val}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              }
            </div>
          );
        })()}

        {/* SHELL */}
        {!loading && activeTab === "shell" && (
          <div>
            {/* EPDK otomatik fiyat kartı */}
            <div style={{ background: "#0f0f1a", border: "1px solid #1e1e2a", borderRadius: "10px", padding: "16px", marginBottom: "16px", borderLeft: "3px solid #ff8c00" }}>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: "#ff8c00", textTransform: "uppercase", letterSpacing: "1px" }}>📡 EPDK Güncel Fiyatlar</div>
                  <button onClick={() => fetchEpdk(true)} disabled={epdkLoading} style={{
                    background: "transparent", border: "1px solid #2a2a3a", color: "#666",
                    padding: "5px 12px", fontSize: "11px", fontWeight: "600",
                    cursor: epdkLoading ? "not-allowed" : "pointer", fontFamily: FONT, borderRadius: "20px",
                    opacity: epdkLoading ? 0.4 : 1,
                  }}>↻ Güncelle</button>
                </div>
                <div style={{ textAlign: "center", fontSize: "12px", color: "#555" }}>
                  {epdkLoading
                    ? <span style={{ color: "#ff8c00", animation: "pulse 1s infinite" }}>⏳ Fiyatlar alınıyor...</span>
                    : <>📍 {epdkData ? epdkData.kaynak.replace(" · Shell", "").replace(" · shell", "") : userIl.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}</>
                  }
                </div>
              </div>
              {epdkError && <div style={{ fontSize: "12px", color: "#ff4444", marginBottom: "8px" }}>⚠ {epdkError}</div>}
              {epdkData ? (
                <div>
                  <div style={{ fontSize: "10px", color: "#444", marginBottom: "10px" }}>Tarih: {epdkData.tarih} · {epdkData.kaynak || "EPDK"}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    {epdkData.benzin95 && (
                      <div style={{ background: "#0a0a0f", padding: "12px", borderRadius: "8px" }}>
                        <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>🟢 Benzin 95</div>
                        <div style={{ fontSize: "18px", fontWeight: "800", color: "#e8e4d9", fontFamily: MONO }}>{formatNumber(epdkData.benzin95.fiyat)} ₺</div>
                        <div style={{ fontSize: "10px", color: "#444", marginTop: "1px", lineHeight: 1.2 }}>{epdkData.benzin95.firma.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}</div>
                      </div>
                    )}
                    {epdkData.motorin && (
                      <div style={{ background: "#0a0a0f", padding: "12px", borderRadius: "8px" }}>
                        <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>⚫ Motorin</div>
                        <div style={{ fontSize: "18px", fontWeight: "800", color: "#e8e4d9", fontFamily: MONO }}>{formatNumber(epdkData.motorin.fiyat)} ₺</div>
                        <div style={{ fontSize: "10px", color: "#444", marginTop: "1px", lineHeight: 1.2 }}>{epdkData.motorin.firma.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}</div>
                      </div>
                    )}

                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "10px" }}>
                    {epdkData.benzin95 && (
                      <button onClick={() => setShellPrice(p => ({ ...p, benzin: toTR(epdkData.benzin95.fiyat) }))}
                        style={{ background: "transparent", border: "1px solid #2a2a3a", color: "#555", padding: "7px 8px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", textAlign: "center", lineHeight: 1.4 }}
                        onMouseEnter={ev => { ev.currentTarget.style.borderColor = "#ff8c00"; ev.currentTarget.style.color = "#ff8c00"; }}
                        onMouseLeave={ev => { ev.currentTarget.style.borderColor = "#2a2a3a"; ev.currentTarget.style.color = "#555"; }}
                      >↓ Benzin fiyatını forma aktar</button>
                    )}
                    {epdkData.motorin && (
                      <button onClick={() => setShellPrice(p => ({ ...p, motorin: toTR(epdkData.motorin.fiyat) }))}
                        style={{ background: "transparent", border: "1px solid #2a2a3a", color: "#555", padding: "7px 8px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", textAlign: "center", lineHeight: 1.4 }}
                        onMouseEnter={ev => { ev.currentTarget.style.borderColor = "#ff8c00"; ev.currentTarget.style.color = "#ff8c00"; }}
                        onMouseLeave={ev => { ev.currentTarget.style.borderColor = "#2a2a3a"; ev.currentTarget.style.color = "#555"; }}
                      >↓ Motorin fiyatını forma aktar</button>
                    )}

                    {(epdkData.benzin95 || epdkData.motorin || epdkData.lpg) && (
                      <button onClick={() => setShellPrice({
                        benzin: epdkData.benzin95 ? toTR(epdkData.benzin95.fiyat) : "",
                        motorin: epdkData.motorin ? toTR(epdkData.motorin.fiyat) : "",
                      })}
                        style={{ background: "#ff8c00", border: "none", color: "#000", padding: "8px 14px", fontSize: "11px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", gridColumn: "1 / -1" }}
                      >↓ Tümünü forma aktar</button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "13px", color: "#555", textAlign: "center", padding: "12px 0" }}>
                  EPDK'dan güncel fiyatı çekmek için "↻ Güncelle" butonuna bas.
                </div>
              )}
            </div>


            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px", minWidth: 0 }}>
              {[{ key: "benzin", label: "Benzin (95)", emoji: "🟢" }, { key: "motorin", label: "Motorin", emoji: "⚫" }].map(f => (
                <div key={f.key} style={{ background: "#0f0f1a", padding: "12px 10px", borderRadius: "10px", minWidth: 0, overflow: "hidden", textAlign: "center" }}>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "#555", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{f.emoji} {f.label}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    <NumericInput placeholder="0,00" value={shellPrice[f.key]} onChange={v => setShellPrice(p => ({ ...p, [f.key]: v }))}
                      style={{ background: "#0a0a0f", border: "1px solid #2a2a3a", color: "#e8e4d9", padding: "8px 6px", fontSize: "14px", fontWeight: "800", width: "100%", fontFamily: MONO, outline: "none", boxSizing: "border-box", borderRadius: "6px", minWidth: 0, textAlign: "center" }} />
                    <span style={{ color: "#555", fontWeight: "600", flexShrink: 0 }}>₺</span>
                  </div>
                  {shellPrice[f.key] && <div style={{ marginTop: "8px", fontSize: "12px", color: "#ff8c00", fontWeight: "600" }}>✓ {formatNumber(parseTR(shellPrice[f.key]))} ₺/L</div>}
                </div>
              ))}
            </div>
            {shellPrice.benzin && avgLiterPrice > 0 && (
              <div style={{ background: "#0f0f1a", padding: "18px", borderRadius: "10px", borderLeft: "3px solid #ff8c00" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#555", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>Karşılaştırma</div>
                <div style={{ fontSize: "14px", lineHeight: 2.2 }}>
                  <span style={{ color: "#555" }}>Ortalama ödediğin:</span>{" "}<span style={{ color: "#ff8c00", fontWeight: "700", fontFamily: MONO }}>{formatNumber(avgLiterPrice)} ₺/L</span><br />
                  <span style={{ color: "#555" }}>Shell 95 fiyatı:</span>{" "}<span style={{ color: "#ffcc00", fontWeight: "700", fontFamily: MONO }}>{formatNumber(parseTR(shellPrice.benzin))} ₺/L</span><br />
                  <span style={{ color: "#555" }}>Fark:</span>{" "}
                  <span style={{ color: avgLiterPrice < parseTR(shellPrice.benzin) ? "#44ff88" : "#ff4444", fontWeight: "700", fontFamily: MONO }}>
                    {formatNumber(avgLiterPrice - parseTR(shellPrice.benzin))} ₺/L{" "}
                    {avgLiterPrice < parseTR(shellPrice.benzin) ? "(daha ucuza aldın ✓)" : "(Shell'den pahalıya aldın)"}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: "40px", paddingTop: "16px", borderTop: "1px solid #1a1a2a", fontSize: "11px", color: "#333", textAlign: "center", fontWeight: "500" }}>
          Fuel Tracker — {entries.length} kayıt
        </div>
      </div>
    </div>
  );
}
