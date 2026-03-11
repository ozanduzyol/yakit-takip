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
  const [userIlce, setUserIlce] = useState("");
  const [epdkLoading, setEpdkLoading] = useState(false);
  const [epdkError, setEpdkError] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [editError, setEditError] = useState(null);
  const [panelFrom, setPanelFrom] = useState("");
  const [panelTo, setPanelTo] = useState("");

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
    const ilce = json.address?.county || json.address?.district || json.address?.town || json.address?.municipality || json.address?.suburb || "";
    return { il, ilce };
  };

  const fetchEpdk = async (useLocation = false) => {
    setEpdkLoading(true);
    setEpdkError(null);
    setEpdkData(null);
    try {
      let il = userIl;
      let ilce = userIlce;
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
    setFetchError(null);
    const { data, error } = await supabase.from("fuel_entries").select("*").order("date", { ascending: true }).order("created_at", { ascending: true });
    if (error) {
      console.error("fetchEntries hatası:", error);
      setFetchError("Kayıtlar yüklenemedi. İnternet bağlantını kontrol et.");
    } else if (data) {
      setEntries(data.map(e => ({
        id: e.id, date: e.date,
        km: parseFloat(e.km), liters: parseFloat(e.liters),
        totalPrice: parseFloat(e.total_price), receipt: e.receipt_url || null,
      })));
    }
    setLoading(false);
  };


  const handleAdd = async () => {
    if (!form.date || !form.km || !form.liters || !form.totalPrice) return;
    setSaving(true);
    setSaveError(null);
    try {
      let receiptUrl = null;
      if (receiptFile) {
        const fileName = `${Date.now()}_${receiptFile.name}`;
        const { error: uploadError } = await supabase.storage.from("receipts").upload(fileName, receiptFile, { contentType: receiptFile.type });
        if (uploadError) console.error("Fiş yükleme hatası:", uploadError);
        else {
          const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(fileName);
          receiptUrl = urlData.publicUrl;
        }
      }
      const { error } = await supabase.from("fuel_entries").insert({
        date: form.date, km: parseTR(form.km), liters: parseTR(form.liters),
        total_price: parseTR(form.totalPrice), receipt_url: receiptUrl,
      });
      if (error) {
        console.error("Kayıt eklenemedi:", error);
        setSaveError("Kayıt eklenemedi. Lütfen tekrar dene.");
      } else {
        await fetchEntries();
        setForm(emptyForm()); setReceiptImage(null); setReceiptFile(null);
        setShowForm(false);
      }
    } catch (e) {
      console.error("handleAdd hatası:", e);
      setSaveError("Beklenmeyen bir hata oluştu.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, receipt) => {
    setDeleteError(null);
    try {
      if (receipt) await supabase.storage.from("receipts").remove([receipt.split("/").pop()]);
      const { error } = await supabase.from("fuel_entries").delete().eq("id", id);
      if (error) {
        console.error("Silme hatası:", error);
        setDeleteError("Kayıt silinemedi. Lütfen tekrar dene.");
      } else {
        await fetchEntries();
      }
    } catch (e) {
      console.error("handleDelete hatası:", e);
      setDeleteError("Beklenmeyen bir hata oluştu.");
    }
  };

  const [editReceiptFile, setEditReceiptFile] = useState(null);
  const [editReceiptPreview, setEditReceiptPreview] = useState(null);

  const startEdit = (e) => {
    setEditingId(e.id);
    setEditReceiptFile(null);
    setEditReceiptPreview(e.receipt || null);
    setEditForm({
      date: e.date,
      km: String(Math.round(e.km)).replace(/\B(?=(\d{3})+(?!\d))/g, "."),
      liters: toTR(e.liters),
      totalPrice: toTR(e.totalPrice),
      receipt: e.receipt || null,
    });
  };

  const handleEditSave = async () => {
    if (!editForm.date || !editForm.km || !editForm.liters || !editForm.totalPrice) return;
    setEditSaving(true);
    setEditError(null);
    try {
      let receiptUrl = editForm.receipt || null;
      if (editReceiptFile) {
        const fileName = `${Date.now()}_${editReceiptFile.name}`;
        const { error: uploadError } = await supabase.storage.from("receipts").upload(fileName, editReceiptFile, { contentType: editReceiptFile.type });
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(fileName);
          receiptUrl = urlData.publicUrl;
        }
      }
      const { error } = await supabase.from("fuel_entries").update({
        date: editForm.date,
        km: parseTR(editForm.km),
        liters: parseTR(editForm.liters),
        total_price: parseTR(editForm.totalPrice),
        receipt_url: receiptUrl,
      }).eq("id", editingId);
      if (error) {
        console.error("Düzenleme hatası:", error);
        setEditError("Kayıt güncellenemedi. Lütfen tekrar dene.");
      } else {
        await fetchEntries();
        setEditingId(null);
      }
    } catch (e) {
      console.error("handleEditSave hatası:", e);
      setEditError("Beklenmeyen bir hata oluştu.");
    } finally {
      setEditSaving(false);
    }
  };

  const panelEntries = entries.filter(e => {
    if (panelFrom && e.date < panelFrom) return false;
    if (panelTo && e.date > panelTo) return false;
    return true;
  });
  const totalKm = panelEntries.length >= 2 ? panelEntries[panelEntries.length - 1].km - panelEntries[0].km : 0;
  const totalLiters = panelEntries.reduce((s, e) => s + e.liters, 0);
  const totalSpent = panelEntries.reduce((s, e) => s + e.totalPrice, 0);
  const avg100km = totalKm > 0 ? (totalLiters / totalKm) * 100 : 0;
  const avgPerKm = totalKm > 0 ? totalSpent / totalKm : 0;
  const avgLiterPrice = totalLiters > 0 ? totalSpent / totalLiters : 0;

  const enriched = entries.map((e, i) => {
    if (i === 0) return { ...e, consumption: null };
    const dist = e.km - entries[i - 1].km;
    return { ...e, consumption: dist > 0 ? (e.liters / dist) * 100 : null };
  });

  const inp = {
    background: "#111e30", border: "1px solid #1a2a45", color: "#e8eef8",
    padding: "10px 12px", width: "100%", maxWidth: "100%", fontSize: "14px", fontFamily: FONT,
    outline: "none", boxSizing: "border-box", borderRadius: "6px", display: "block",
  };

  const editInp = {
    background: "#080c14", border: "1px solid #64d2ff", color: "#e8eef8",
    padding: "6px 10px", width: "100%", maxWidth: "100%", minWidth: 0, fontSize: "13px", fontFamily: MONO,
    outline: "none", boxSizing: "border-box", borderRadius: "5px", fontWeight: "700",
    WebkitAppearance: "none", appearance: "none", display: "block",
  };

  const lbl = { fontSize: "10px", letterSpacing: "1px", color: "#4a6080", display: "block", marginBottom: "6px", fontWeight: "600", textTransform: "uppercase", fontFamily: FONT };

  return (
    <div style={{ minHeight: "100vh", background: "#080c14", color: "#e8eef8", fontFamily: FONT, overflowX: "clip" }}>
      <meta name="theme-color" content="#080c14" />
      <style>{`body { background: #080c14 !important; margin: 0; }`}</style>
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
        input, select, textarea { font-size: 16px !important; }
        * { box-sizing: border-box; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        button { transition: all 0.15s ease; }
        .card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .card:active { transform: scale(0.99); }
      `}</style>
      <div style={{ position: "relative", zIndex: 1, maxWidth: "860px", margin: "0 auto", padding: "24px 16px 110px 16px" }}>

        <div style={{ marginBottom: "28px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#64d2ff", marginBottom: "6px", fontWeight: "600" }}>⛽ YAKIT TAKİP</div>
          <h1 style={{ fontSize: "clamp(26px,5vw,42px)", fontWeight: "900", margin: 0, letterSpacing: "-1px", lineHeight: 1.1 }}>
            Fuel <span style={{ color: "#64d2ff" }}>Tracker</span>
          </h1>
        </div>



        {loading && <div style={{ textAlign: "center", padding: "48px", color: "#4a6080", fontSize: "13px" }}>Yükleniyor...</div>}
        {!loading && fetchError && (
          <div style={{ background: "#0a0a1a", border: "1px solid #ff4444", borderRadius: "10px", padding: "16px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <span style={{ color: "#ff4444", fontSize: "13px" }}>⚠ {fetchError}</span>
            <button onClick={fetchEntries} style={{ background: "transparent", border: "1px solid #ff4444", color: "#ff4444", padding: "6px 14px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", whiteSpace: "nowrap" }}>
              Tekrar Dene
            </button>
          </div>
        )}

        {/* DASHBOARD */}
        {!loading && activeTab === "dashboard" && (
          <div>
            {entries.length < 2 && (
              <div style={{ background: "#0f1829", border: "1px dashed #1a2a45", borderRadius: "10px", padding: "32px", textAlign: "center", marginBottom: "20px" }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>⛽</div>
                <div style={{ color: "#4a6080", fontSize: "13px" }}>İstatistikler için en az 2 kayıt gereklidir.</div>
              </div>
            )}
            {entries.length >= 2 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", marginBottom: "12px", alignItems: "end" }}>
                <div>
                  <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Başlangıç</div>
                  <input type="date" value={panelFrom} onChange={e => setPanelFrom(e.target.value)} style={{ ...inp, fontSize: "12px", padding: "7px 10px", width: "100%", boxSizing: "border-box", height: "38px" }} />
                </div>
                <div>
                  <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Bitiş</div>
                  <input type="date" value={panelTo} onChange={e => setPanelTo(e.target.value)} style={{ ...inp, fontSize: "12px", padding: "7px 10px", width: "100%", boxSizing: "border-box", height: "38px" }} />
                </div>
                <button onClick={() => { setPanelFrom(""); setPanelTo(""); }} style={{ background: "none", border: "1px solid #1a2a45", color: panelFrom || panelTo ? "#64d2ff" : "#1a2a45", fontSize: "13px", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", width: "38px", height: "38px", boxSizing: "border-box", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
            )}
            {entries.length >= 2 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px", marginBottom: "8px" }}>
                {[
                  { label: "L / 100 km", val: formatNumber(avg100km), unit: "L", accent: true },
                  { label: "₺ / km", val: formatNumber(avgPerKm), unit: "₺", accent: true },
                  { label: "₺ / litre", val: formatNumber(avgLiterPrice), unit: "₺", accent: true },
                ].map(s => (
                  <div key={s.label} className="card" style={{ background: "#0f1829", borderRadius: "12px", padding: "14px 12px", borderTop: "2px solid #64d2ff" }}>
                    <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>{s.label}</div>
                    <div style={{ fontSize: "22px", fontWeight: "800", color: "#64d2ff", fontFamily: MONO, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px", marginBottom: "20px" }}>
                {[
                  { label: "Toplam km", val: formatNumber(totalKm, 0) },
                  { label: "Toplam litre", val: formatNumber(totalLiters) },
                  { label: "Toplam ₺", val: formatNumber(totalSpent) },
                ].map(s => (
                  <div key={s.label} className="card" style={{ background: "#0f1829", borderRadius: "12px", padding: "14px 12px" }}>
                    <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>{s.label}</div>
                    <div style={{ fontSize: "18px", fontWeight: "700", color: "#e8eef8", fontFamily: MONO, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.val}</div>
                  </div>
                ))}
              </div>
            </>)}

            <button onClick={() => { setShowForm(!showForm); if (!showForm) setTimeout(() => document.getElementById("kayit-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }} style={{
              background: showForm ? "transparent" : "#64d2ff", color: showForm ? "#64d2ff" : "#000",
              border: "1px solid #64d2ff", padding: "13px 28px", fontSize: "13px", fontWeight: "700",
              cursor: "pointer", fontFamily: FONT, display: "block", width: "100%", marginBottom: "8px", borderRadius: "8px",
            }}>
              {showForm ? "✕ İptal" : "+ Yeni Kayıt Ekle"}
            </button>

            {showForm && (
              <div id="kayit-form" style={{ background: "#0d1524", padding: "20px", border: "1px solid #1a2a45", borderRadius: "12px" }}>
                <div style={{ marginBottom: "18px" }}>
                  <div style={{ ...lbl, color: "#64d2ff" }}>📷 Fiş Fotoğrafı (Opsiyonel)</div>
                  <label style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", background: "#080c14", border: "1px dashed #333", padding: "14px 16px", borderRadius: "8px" }}>
                    <input type="file" accept="image/*" onChange={e => { const f = e.target.files[0]; if (!f) return; setReceiptFile(f); setReceiptImage(URL.createObjectURL(f)); }} style={{ display: "none" }} />
                    {receiptImage ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <img src={receiptImage} alt="fiş" style={{ width: "40px", height: "54px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "4px" }} />
                        <span style={{ color: "#44ff88", fontSize: "13px" }}>✓ Fotoğraf eklendi</span>
                      </div>
                    ) : <span style={{ color: "#4a6080", fontSize: "13px" }}>+ Fiş fotoğrafı ekle</span>}
                  </label>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={lbl}>Tarih</span>
                      <button onClick={() => setDateMode(dateMode === "picker" ? "manual" : "picker")} style={{ background: "none", border: "none", color: "#64d2ff", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, padding: 0 }}>
                        {dateMode === "picker" ? "Manuel" : "Takvim"}
                      </button>
                    </div>
                    {dateMode === "picker"
                      ? <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} style={{ ...inp, borderColor: form.date ? "#64d2ff" : "#1a2a45", colorScheme: "dark", maxWidth: "100%", display: "block" }} />
                      : <input type="text" placeholder="GG.AA.YYYY" value={form.date} onChange={e => {
                          const raw = e.target.value;
                          setForm(p => {
                            const parts = raw.split(".");
                            const iso = parts.length === 3 && parts[2].length === 4 ? `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}` : raw;
                            return { ...p, date: iso };
                          });
                        }} style={{ ...inp, borderColor: form.date ? "#64d2ff" : "#1a2a45" }} />}
                  </div>
                  <div><label style={lbl}>Güncel Km</label><NumericInput placeholder="45.230" value={form.km} onChange={v => setForm(p => ({ ...p, km: v }))} style={{ ...inp, borderColor: form.km ? "#64d2ff" : "#1a2a45" }} /></div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <label style={lbl}>Ödenen Toplam ₺</label>
                      {shellPrice.benzin && (
                        <span style={{ fontSize: "10px", color: "#64d2ff", fontWeight: "600" }}>
                          Shell 95: {formatNumber(parseTR(shellPrice.benzin))} ₺/L
                        </span>
                      )}
                    </div>
                    <NumericInput placeholder="1.250,00" value={form.totalPrice} onChange={v => setForm(p => ({ ...p, totalPrice: v }))} style={{ ...inp, borderColor: form.totalPrice ? "#64d2ff" : "#1a2a45" }} />
                    {form.totalPrice && shellPrice.benzin && (() => {
                      const litre = parseTR(form.totalPrice) / parseTR(shellPrice.benzin);
                      return litre > 0 ? (
                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#64d2ff", fontWeight: "600" }}>
                          ≈ {formatNumber(litre)} litre
                          <button onClick={() => setForm(p => ({ ...p, liters: toTR(litre) }))}
                            style={{ marginLeft: "10px", background: "transparent", border: "1px solid #64d2ff", color: "#64d2ff", padding: "2px 8px", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "4px" }}>
                            Kullan
                          </button>
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <label style={lbl}>Alınan Litre</label>
                      {form.liters && <span style={{ fontSize: "10px", color: "#4a6080" }}>{formatNumber(parseTR(form.liters))} L</span>}
                    </div>
                    <NumericInput placeholder="35,5" value={form.liters} onChange={v => setForm(p => ({ ...p, liters: v }))} style={{ ...inp, borderColor: form.liters ? "#64d2ff" : "#1a2a45" }} />
                  </div>
                </div>

                <button onClick={handleAdd} disabled={saving || !form.date || !form.km || !form.liters || !form.totalPrice} style={{
                  background: (saving || !form.date || !form.km || !form.liters || !form.totalPrice) ? "#1a2a45" : "#64d2ff",
                  color: (saving || !form.date || !form.km || !form.liters || !form.totalPrice) ? "#3d5270" : "#000",
                  border: "none", padding: "12px 28px", fontSize: "13px", fontWeight: "700",
                  cursor: "pointer", fontFamily: FONT, borderRadius: "8px",
                }}>
                  {saving ? "Kaydediliyor..." : "Kaydet →"}
                </button>
                {saveError && <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "8px" }}>⚠ {saveError}</div>}
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
            {months.length > 1 && (
              <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
                <button onClick={() => setFilterMonth("all")} style={{
                  background: filterMonth === "all" ? "#64d2ff" : "transparent",
                  color: filterMonth === "all" ? "#000" : "#4a6080",
                  border: "1px solid " + (filterMonth === "all" ? "#64d2ff" : "#1a2a45"),
                  padding: "5px 12px", fontSize: "11px", fontWeight: "600",
                  cursor: "pointer", fontFamily: FONT, borderRadius: "20px",
                }}>Tümü</button>
                {months.map(m => (
                  <button key={m} onClick={() => setFilterMonth(m)} style={{
                    background: filterMonth === m ? "#64d2ff" : "transparent",
                    color: filterMonth === m ? "#000" : "#4a6080",
                    border: "1px solid " + (filterMonth === m ? "#64d2ff" : "#1a2a45"),
                    padding: "5px 12px", fontSize: "11px", fontWeight: "600",
                    cursor: "pointer", fontFamily: FONT, borderRadius: "20px",
                  }}>{monthName(m)}</button>
                ))}
              </div>
            )}
            {filteredEnriched.length === 0
              ? <div style={{ color: "#4a6080", textAlign: "center", padding: "48px", fontSize: "14px" }}>Bu ayda kayıt yok.</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {filteredEnriched.map((e, i) => (
                    <div key={e.id} className="card" style={{ background: "#0f1829", borderRadius: "12px", borderLeft: i === 0 ? "3px solid #1a2a45" : "3px solid #64d2ff", overflow: "hidden" }}>
                      {editingId === e.id ? (
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
                            <div>
                              <div style={{ ...lbl, marginBottom: "4px" }}>📷 Fiş Fotoğrafı</div>
                              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", background: "#080c14", border: "1px dashed #1a2a45", padding: "10px 12px", borderRadius: "8px" }}>
                                <input type="file" accept="image/*" onChange={ev => { const f = ev.target.files[0]; if (!f) return; setEditReceiptFile(f); setEditReceiptPreview(URL.createObjectURL(f)); }} style={{ display: "none" }} />
                                {editReceiptPreview
                                  ? <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                      <img src={editReceiptPreview} alt="fiş" style={{ width: "30px", height: "30px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "5px" }} />
                                      <span style={{ color: "#44cc88", fontSize: "12px" }}>✓ Fotoğraf seçildi</span>
                                    </div>
                                  : <span style={{ color: "#4a6080", fontSize: "12px" }}>+ Fotoğraf ekle</span>}
                              </label>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <button onClick={handleEditSave} disabled={editSaving} style={{
                              background: "#64d2ff", color: "#000", border: "none", padding: "8px 20px",
                              fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px",
                            }}>{editSaving ? "Kaydediliyor..." : "Kaydet ✓"}</button>
                            <button onClick={() => { setEditingId(null); setEditError(null); }} style={{
                              background: "transparent", color: "#888", border: "1px solid #1a2a45", padding: "8px 16px",
                              fontSize: "12px", cursor: "pointer", fontFamily: FONT, borderRadius: "6px",
                            }}>İptal</button>
                          </div>
                          {editError && <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "8px" }}>⚠ {editError}</div>}
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 8px", flexWrap: "wrap", gap: "6px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontSize: "15px", fontWeight: "800", color: i === 0 ? "#4a6080" : "#e8eef8", fontFamily: MONO, letterSpacing: "-0.3px" }}>{e.date}</span>
                              {e.consumption && i > 0 && (() => {
                                const prev = enriched[i - 1];
                                if (!prev?.consumption) return null;
                                const diff = e.consumption - prev.consumption;
                                if (Math.abs(diff) < 0.1) return null;
                                return <span style={{ fontSize: "11px", fontWeight: "700", color: diff < 0 ? "#44cc88" : "#ff6655" }}>{diff < 0 ? "↓" : "↑"} {formatNumber(Math.abs(diff))} L/100km</span>;
                              })()}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              {e.receipt && (
                                <a href={e.receipt} target="_blank" rel="noopener noreferrer">
                                  <img src={e.receipt} alt="fiş" style={{ width: "30px", height: "30px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "5px", display: "block" }} />
                                </a>
                              )}
                              <button onClick={() => startEdit(e)} style={{ background: "none", border: "1px solid #1a2a45", color: "#666", cursor: "pointer", padding: "5px 9px", fontSize: "11px", fontFamily: FONT, borderRadius: "5px" }}
                                onMouseEnter={ev => { ev.target.style.borderColor = "#64d2ff"; ev.target.style.color = "#64d2ff"; }}
                                onMouseLeave={ev => { ev.target.style.borderColor = "#1a2a45"; ev.target.style.color = "#666"; }}
                              >✎</button>
                              <button onClick={() => handleDelete(e.id, e.receipt)} style={{ background: "none", border: "1px solid #1a2a45", color: "#3d5270", cursor: "pointer", padding: "5px 9px", fontSize: "12px", fontFamily: FONT, borderRadius: "5px" }}
                                onMouseEnter={ev => { ev.target.style.borderColor = "#ff4444"; ev.target.style.color = "#ff4444"; }}
                                onMouseLeave={ev => { ev.target.style.borderColor = "#1a2a45"; ev.target.style.color = "#3d5270"; }}
                              >✕</button>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", borderTop: "1px solid #1a2a45" }}>
                            {[
                              { label: "Km", val: formatNumber(e.km, 0) },
                              { label: "Miktar", val: `${formatNumber(e.liters)} L` },
                              { label: "L/100km", val: e.consumption ? `${formatNumber(e.consumption)}` : "—", highlight: !!e.consumption },
                              { label: "Harcama", val: `${formatNumber(e.totalPrice)} ₺` },
                              { label: "₺/Km", val: e.consumption && (e.km - (enriched[enriched.findIndex(x => x.id === e.id) - 1]?.km || e.km)) > 0 ? `${formatNumber(e.totalPrice / (e.km - (enriched[enriched.findIndex(x => x.id === e.id) - 1]?.km || e.km)))}` : "—" },
                            ].map((col, ci) => (
                              <div key={col.label} style={{ padding: "8px 4px", borderRight: ci < 4 ? "1px solid #1a2a45" : "none" }}>
                                <div style={{ fontSize: "8px", fontWeight: "600", color: "#3d5270", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>{col.label}</div>
                                <div style={{ fontSize: "12px", fontWeight: "700", color: col.highlight ? "#64d2ff" : "#8aa4c8", fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{col.val}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
            }

            {deleteError && <div style={{ color: "#ff4444", fontSize: "12px", margin: "8px 0" }}>⚠ {deleteError}</div>}
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
                  background: "transparent", color: "#4a6080",
                  border: "1px solid #1a2a45", padding: "11px 20px", fontSize: "12px",
                  fontWeight: "600", cursor: "pointer", fontFamily: FONT,
                  display: "flex", alignItems: "center", gap: "8px",
                  borderRadius: "8px", flex: 1, justifyContent: "center",
                };
                return (
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button onClick={() => downloadCSV(filteredEnriched, `fuel-tracker-${filterMonth === "all" ? "tum" : filterMonth}-${new Date().toISOString().slice(0,10)}.csv`)}
                      style={btnStyle}
                      onMouseEnter={ev => { ev.currentTarget.style.borderColor = "#64d2ff"; ev.currentTarget.style.color = "#64d2ff"; }}
                      onMouseLeave={ev => { ev.currentTarget.style.borderColor = "#1a2a45"; ev.currentTarget.style.color = "#4a6080"; }}
                    >↓ {filterMonth === "all" ? "CSV indir" : "Seçili ayı indir"}</button>
                    {filterMonth !== "all" && (
                      <button onClick={() => downloadCSV(enriched, `fuel-tracker-tum-${new Date().toISOString().slice(0,10)}.csv`)}
                        style={btnStyle}
                        onMouseEnter={ev => { ev.currentTarget.style.borderColor = "#64d2ff"; ev.currentTarget.style.color = "#64d2ff"; }}
                        onMouseLeave={ev => { ev.currentTarget.style.borderColor = "#1a2a45"; ev.currentTarget.style.color = "#4a6080"; }}
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
                ? <div style={{ color: "#4a6080", textAlign: "center", padding: "48px", fontSize: "14px" }}>Henüz kayıt yok.</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {months.map(key => {
                      const m = byMonth[key];
                      const sortedE = m.entries.sort((a,b) => a.date.localeCompare(b.date));
                      const monthKm = sortedE.length >= 2 ? sortedE[sortedE.length-1].km - sortedE[0].km : null;
                      const cons = monthKm > 0 ? (m.liters / monthKm) * 100 : null;
                      return (
                        <div key={key} className="card" style={{ background: "#0f1829", borderRadius: "12px", borderLeft: "3px solid #64d2ff", overflow: "hidden" }}>
                          <div style={{ padding: "12px 14px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "15px", fontWeight: "800", color: "#e8eef8", fontFamily: MONO }}>{monthName(key)}</span>
                            <span style={{ fontSize: "11px", color: "#4a6080", fontWeight: "500" }}>{m.count} dolum</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", borderTop: "1px solid #1a2a45" }}>
                            {[
                              { label: "Top. Km", val: monthKm ? `${formatNumber(monthKm, 0)}` : "—" },
                              { label: "Miktar", val: `${formatNumber(m.liters)} L` },
                              { label: "L/100km", val: cons ? `${formatNumber(cons)}` : "—", highlight: !!cons },
                              { label: "Harcama", val: `${formatNumber(m.spent)} ₺` },
                              { label: "₺/Km", val: monthKm > 0 ? `${formatNumber(m.spent / monthKm)}` : "—" },
                            ].map((col, ci) => (
                              <div key={col.label} style={{ padding: "8px 4px", borderRight: ci < 4 ? "1px solid #1a2a45" : "none" }}>
                                <div style={{ fontSize: "8px", fontWeight: "600", color: "#3d5270", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>{col.label}</div>
                                <div style={{ fontSize: "12px", fontWeight: "700", color: col.highlight ? "#64d2ff" : "#8aa4c8", fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{col.val}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>
          );
        })()}

        {/* GRAPHS — YENİ SEKME */}
        {!loading && activeTab === "graphs" && (() => {
          const byMonth = {};
          enriched.forEach(e => {
            const key = e.date.slice(0, 7);
            if (!byMonth[key]) byMonth[key] = { liters: 0, spent: 0, entries: [] };
            byMonth[key].liters += e.liters;
            byMonth[key].spent += e.totalPrice;
            byMonth[key].entries.push(e);
          });
          const monthKeys = Object.keys(byMonth).sort();
          const names = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
          const chartData = monthKeys.map(key => {
            const m = byMonth[key];
            const [y, mo] = key.split("-");
            const label = `${names[parseInt(mo)-1]} ${y.slice(2)}`;
            const sortedE = [...m.entries].sort((a,b) => a.date.localeCompare(b.date));
            const monthKm = sortedE.length >= 2 ? sortedE[sortedE.length-1].km - sortedE[0].km : null;
            const cons = monthKm > 0 ? parseFloat((m.liters / monthKm * 100).toFixed(2)) : null;
            const km = monthKm ? parseFloat(monthKm.toFixed(0)) : null;
            const costPerKm = monthKm > 0 ? parseFloat((m.spent / monthKm).toFixed(2)) : null;
            return { label, liters: parseFloat(m.liters.toFixed(2)), spent: parseFloat(m.spent.toFixed(2)), cons, km, costPerKm };
          });
          const charts = [
            { key: "km", label: "Aylık Km", color: "#cc88ff", unit: "km" },
            { key: "liters", label: "Aylık Yakıt Miktarı (L)", color: "#44aaff", unit: "L" },
            { key: "cons", label: "Aylık L/100 km", color: "#44ff88", unit: "L" },
            { key: "spent", label: "Aylık Harcama (₺)", color: "#ff6655", unit: "₺" },
            { key: "costPerKm", label: "Aylık ₺/Km", color: "#ffdd00", unit: "₺" },
          ];
          return (
            <div>
              {chartData.length < 2
                ? <div style={{ color: "#4a6080", textAlign: "center", padding: "48px", fontSize: "14px" }}>Grafik için en az 2 aylık kayıt gereklidir.</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {charts.map(c => (
                      <div key={c.key} style={{ background: "#0f1829", borderRadius: "12px", padding: "16px", borderLeft: `3px solid ${c.color}` }}>
                        <div style={{ fontSize: "10px", fontWeight: "700", color: c.color, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>{c.label}</div>
                        <ResponsiveContainer width="100%" height={140}>
                          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1a2a45" />
                            <XAxis dataKey="label" tick={{ fill: "#4a6080", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: "#4a6080", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <Tooltip
                              contentStyle={{ background: "#080c14", border: "1px solid #1a2a45", borderRadius: "6px", fontSize: "12px" }}
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
              }
            </div>
          );
        })()}

        {/* SHELL */}
        {!loading && activeTab === "shell" && (
          <div>
            <div style={{ background: "#0f1829", border: "1px solid #1a2a45", borderRadius: "10px", padding: "16px", marginBottom: "16px", borderLeft: "3px solid #64d2ff" }}>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: "#64d2ff", textTransform: "uppercase", letterSpacing: "1px" }}>📡 EPDK Güncel Fiyatlar</div>
                  <button onClick={() => fetchEpdk(true)} disabled={epdkLoading} style={{
                    background: "transparent", border: "1px solid #1a2a45", color: "#666",
                    padding: "5px 12px", fontSize: "11px", fontWeight: "600",
                    cursor: epdkLoading ? "not-allowed" : "pointer", fontFamily: FONT, borderRadius: "20px",
                    opacity: epdkLoading ? 0.4 : 1,
                  }}>↻ Güncelle</button>
                </div>
                <div style={{ textAlign: "center", fontSize: "12px", color: "#4a6080" }}>
                  {epdkLoading
                    ? <span style={{ color: "#64d2ff", animation: "pulse 1s infinite" }}>⏳ Fiyatlar alınıyor...</span>
                    : <>📍 {(userIl || "").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}{userIlce ? ` / ${userIlce.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}` : ""}</>
                  }
                </div>
              </div>
              {epdkError && <div style={{ fontSize: "12px", color: "#ff4444", marginBottom: "8px" }}>⚠ {epdkError}</div>}
              {epdkData ? (
                <div>
                  <div style={{ fontSize: "10px", color: "#3d5270", marginBottom: "10px" }}>Tarih: {epdkData.tarih}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    {epdkData.benzin95 && (
                      <div style={{ background: "#080c14", padding: "12px", borderRadius: "8px" }}>
                        <div style={{ fontSize: "10px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>🟢 Benzin 95</div>
                        <div style={{ fontSize: "18px", fontWeight: "800", color: "#e8eef8", fontFamily: MONO }}>{formatNumber(epdkData.benzin95.fiyat)} ₺</div>
                        <div style={{ fontSize: "10px", color: "#3d5270", marginTop: "1px", lineHeight: 1.2 }}>{[userIl, userIlce].filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" / ")}</div>
                      </div>
                    )}
                    {epdkData.motorin && (
                      <div style={{ background: "#080c14", padding: "12px", borderRadius: "8px" }}>
                        <div style={{ fontSize: "10px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>⚫ Motorin</div>
                        <div style={{ fontSize: "18px", fontWeight: "800", color: "#e8eef8", fontFamily: MONO }}>{formatNumber(epdkData.motorin.fiyat)} ₺</div>
                        <div style={{ fontSize: "10px", color: "#3d5270", marginTop: "1px", lineHeight: 1.2 }}>{[userIl, userIlce].filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" / ")}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "10px" }}>
                    {epdkData.benzin95 && (
                      <button onClick={() => setShellPrice(p => ({ ...p, benzin: toTR(epdkData.benzin95.fiyat) }))}
                        style={{ background: "transparent", border: "1px solid #1a2a45", color: "#4a6080", padding: "7px 8px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", textAlign: "center", lineHeight: 1.4 }}
                        onMouseEnter={ev => { ev.currentTarget.style.borderColor = "#64d2ff"; ev.currentTarget.style.color = "#64d2ff"; }}
                        onMouseLeave={ev => { ev.currentTarget.style.borderColor = "#1a2a45"; ev.currentTarget.style.color = "#4a6080"; }}
                      >↓ Benzin fiyatını forma aktar</button>
                    )}
                    {epdkData.motorin && (
                      <button onClick={() => setShellPrice(p => ({ ...p, motorin: toTR(epdkData.motorin.fiyat) }))}
                        style={{ background: "transparent", border: "1px solid #1a2a45", color: "#4a6080", padding: "7px 8px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", textAlign: "center", lineHeight: 1.4 }}
                        onMouseEnter={ev => { ev.currentTarget.style.borderColor = "#64d2ff"; ev.currentTarget.style.color = "#64d2ff"; }}
                        onMouseLeave={ev => { ev.currentTarget.style.borderColor = "#1a2a45"; ev.currentTarget.style.color = "#4a6080"; }}
                      >↓ Motorin fiyatını forma aktar</button>
                    )}
                    {(epdkData.benzin95 || epdkData.motorin) && (
                      <button onClick={() => setShellPrice({
                        benzin: epdkData.benzin95 ? toTR(epdkData.benzin95.fiyat) : "",
                        motorin: epdkData.motorin ? toTR(epdkData.motorin.fiyat) : "",
                      })}
                        style={{ background: "#64d2ff", border: "none", color: "#000", padding: "8px 14px", fontSize: "11px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", gridColumn: "1 / -1" }}
                      >↓ Tümünü forma aktar</button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "13px", color: "#4a6080", textAlign: "center", padding: "12px 0" }}>
                  EPDK'dan güncel fiyatı çekmek için "↻ Güncelle" butonuna bas.
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px", minWidth: 0 }}>
              {[{ key: "benzin", label: "Benzin (95)", emoji: "🟢" }, { key: "motorin", label: "Motorin", emoji: "⚫" }].map(f => (
                <div key={f.key} style={{ background: "#0f1829", padding: "12px 10px", borderRadius: "10px", minWidth: 0, overflow: "hidden", textAlign: "center" }}>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "#4a6080", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{f.emoji} {f.label}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    <NumericInput placeholder="0,00" value={shellPrice[f.key]} onChange={v => setShellPrice(p => ({ ...p, [f.key]: v }))}
                      style={{ background: "#080c14", border: "1px solid #1a2a45", color: "#e8eef8", padding: "8px 6px", fontSize: "14px", fontWeight: "800", width: "100%", fontFamily: MONO, outline: "none", boxSizing: "border-box", borderRadius: "6px", minWidth: 0, textAlign: "center" }} />
                    <span style={{ color: "#4a6080", fontWeight: "600", flexShrink: 0 }}>₺</span>
                  </div>
                  {shellPrice[f.key] && <div style={{ marginTop: "8px", fontSize: "12px", color: "#64d2ff", fontWeight: "600" }}>✓ {formatNumber(parseTR(shellPrice[f.key]))} ₺/L</div>}
                </div>
              ))}
            </div>

          </div>
        )}

        <div style={{ marginTop: "40px", paddingTop: "16px", borderTop: "1px solid #1a2a45", fontSize: "11px", color: "#1a2a45", textAlign: "center", fontWeight: "500" }}>
          Fuel Tracker — {entries.length} kayıt
        </div>
      </div>

      {/* SABİT BOTTOM TAB BAR */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
        background: "rgba(8,12,20,0.92)", borderTop: "1px solid #1a2a45", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        display: "flex", alignItems: "stretch", justifyContent: "center",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {[
          { id: "dashboard", emoji: "📊", label: "Panel" },
          { id: "records",   emoji: "📋", label: "Kayıtlar" },
          { id: "monthly",   emoji: "📅", label: "Aylık" },
          { id: "graphs",    emoji: "📈", label: "Grafik" },
          { id: "shell",     emoji: "⛽", label: "Fiyatlar" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            flex: "0 1 18%", background: "none", border: "none", minWidth: 0, maxWidth: "18%",
            color: activeTab === tab.id ? "#64d2ff" : "#4a6080",
            fontFamily: FONT, cursor: "pointer",
            borderTop: activeTab === tab.id ? "2px solid #64d2ff" : "2px solid transparent",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "10px 0 8px", gap: "2px",
          }}>
            <span style={{ fontSize: "16px", lineHeight: 1 }}>{tab.emoji}</span>
            <span style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.2px", whiteSpace: "nowrap", overflow: "hidden", maxWidth: "100%", textAlign: "center" }}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
