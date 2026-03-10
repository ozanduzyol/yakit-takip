import { useState, useEffect } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://delljhepbcevggfokcwy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbGxqaGVwYmNldmdnZm9rY3d5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODAzNDgsImV4cCI6MjA4ODU1NjM0OH0.HIgJdaZ0pk7uRNBYMuW4kkBlTlZoXcxQP74f8J_s6SU";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Format number: binlik . ondalık ,
function formatNumber(val, decimals = 2) {
  if (val === null || val === undefined || val === "") return "";
  const num = parseFloat(val);
  if (isNaN(num)) return "";
  return num.toLocaleString("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Numeric input: binlik . ondalik , otomatik format
function NumericInput({ value, onChange, placeholder, style }) {
  const handleChange = (e) => {
    const stripped = e.target.value.replace(/[^0-9,]/g, "");
    const parts = stripped.split(",");
    const intPart = parts[0].replace(/\./g, "");
    const decPart = parts.length > 1 ? "," + parts.slice(1).join("") : "";
    const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + decPart;
    onChange(formatted);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      pattern="[0-9.,]*"
      placeholder={placeholder}
      value={value}
      onChange={handleChange}
      style={style}
    />
  );
}

export default function FuelTracker() {
  const [entries, setEntries] = useState([]);
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ date: today, km: "", liters: "", totalPrice: "" });
  const [shellPrice, setShellPrice] = useState({ benzin: "", motorin: "", lpg: "" });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showForm, setShowForm] = useState(false);
  const [receiptImage, setReceiptImage] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dateMode, setDateMode] = useState("picker"); // "picker" | "manual"

  useEffect(() => { fetchEntries(); }, []);

  const fetchEntries = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("fuel_entries")
      .select("*")
      .order("date", { ascending: true });
    if (!error && data) {
      setEntries(data.map(e => ({
        id: e.id,
        date: e.date,
        km: parseFloat(e.km),
        liters: parseFloat(e.liters),
        totalPrice: parseFloat(e.total_price),
        receipt: e.receipt_url || null,
      })));
    }
    setLoading(false);
  };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setScanError(null);
    setScanning(true);
    setReceiptFile(file);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(",")[1];
      setReceiptImage(ev.target.result);
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: file.type, data: base64 } },
                { type: "text", text: `Bu bir akaryakıt fişi. Sadece JSON döndür:\n{"date":"YYYY-MM-DD","liters":"","totalPrice":"","km":""}` }
              ]
            }]
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
      } catch {
        setScanError("Fiş okunamadı. Lütfen bilgileri manuel girin.");
      } finally {
        setScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Parse Turkish formatted number (comma as decimal)
  const parseTR = (str) => parseFloat((str || "").replace(/\./g, "").replace(",", "."));

  const handleAdd = async () => {
    if (!form.date || !form.km || !form.liters || !form.totalPrice) return;
    setSaving(true);
    let receiptUrl = null;
    if (receiptFile) {
      const fileName = `${Date.now()}_${receiptFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(fileName, receiptFile, { contentType: receiptFile.type });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(fileName);
        receiptUrl = urlData.publicUrl;
      }
    }
    const { error } = await supabase.from("fuel_entries").insert({
      date: form.date,
      km: parseTR(form.km),
      liters: parseTR(form.liters),
      total_price: parseTR(form.totalPrice),
      receipt_url: receiptUrl,
    });
    if (!error) {
      await fetchEntries();
      setForm({ date: new Date().toISOString().split("T")[0], km: "", liters: "", totalPrice: "" });
      setReceiptImage(null);
      setReceiptFile(null);
      setShowForm(false);
      setScanError(null);
    }
    setSaving(false);
  };

  const handleDelete = async (id, receipt) => {
    if (receipt) {
      const fileName = receipt.split("/").pop();
      await supabase.storage.from("receipts").remove([fileName]);
    }
    await supabase.from("fuel_entries").delete().eq("id", id);
    await fetchEntries();
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
    background: "#13131f",
    border: "1px solid #2a2a3a",
    color: "#e8e4d9",
    padding: "10px 12px",
    width: "100%",
    fontSize: "14px",
    fontFamily: "'Courier New', monospace",
    outline: "none",
    boxSizing: "border-box",
  };

  const formBg = "#0d0d18";

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e4d9", fontFamily: "'Courier New', monospace" }}>
      <div style={{ position: "fixed", top: "-20%", right: "-10%", width: "500px", height: "500px", background: "radial-gradient(circle, rgba(255,140,0,0.08) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: "900px", margin: "0 auto", padding: "24px 20px" }}>

        {/* Header — no logo image, just text */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#ff8c00", marginBottom: "4px" }}>⛽ YAKIT TAKİP</div>
          <h1 style={{ fontSize: "clamp(28px,6vw,48px)", fontWeight: "900", margin: 0, letterSpacing: "-2px", lineHeight: 1 }}>
            FUEL<br /><span style={{ color: "#ff8c00" }}>TRACKER</span>
          </h1>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "2px", marginBottom: "28px", borderBottom: "1px solid #1e1e2a" }}>
          {["dashboard", "records", "shell"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              background: "none", border: "none", color: activeTab === tab ? "#ff8c00" : "#555",
              fontSize: "11px", letterSpacing: "3px", textTransform: "uppercase", padding: "10px 20px",
              cursor: "pointer", borderBottom: activeTab === tab ? "2px solid #ff8c00" : "2px solid transparent",
              fontFamily: "'Courier New', monospace",
            }}>
              {tab === "dashboard" ? "PANEL" : tab === "records" ? "KAYITLAR" : "SHELL"}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "48px", color: "#555", letterSpacing: "3px", fontSize: "11px" }}>⏳ YÜKLENİYOR...</div>
        )}

        {/* DASHBOARD */}
        {!loading && activeTab === "dashboard" && (
          <div>
            {entries.length < 2 && (
              <div style={{ background: "#0f0f1a", border: "1px dashed #2a2a3a", padding: "32px", textAlign: "center", marginBottom: "24px" }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>⛽</div>
                <div style={{ color: "#555", fontSize: "13px", letterSpacing: "1px" }}>İstatistikler için en az 2 kayıt gereklidir.</div>
              </div>
            )}
            {entries.length >= 2 && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "2px", marginBottom: "2px" }}>
                  {[
                    { label: "100 KM TÜKETİM", value: `${formatNumber(avg100km)} L`, unit: "/ 100 km" },
                    { label: "KM MALİYETİ", value: `${formatNumber(avgPerKm)} ₺`, unit: "/ km" },
                    { label: "LİTRE FİYATI", value: `${formatNumber(avgLiterPrice)} ₺`, unit: "/ L ort." },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#0f0f1a", padding: "24px 20px", borderLeft: "3px solid #ff8c00" }}>
                      <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#666", marginBottom: "8px" }}>{s.label}</div>
                      <div style={{ fontSize: "28px", fontWeight: "900", color: "#ff8c00", lineHeight: 1 }}>{s.value}</div>
                      <div style={{ fontSize: "10px", color: "#444", marginTop: "4px" }}>{s.unit}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "2px", marginBottom: "24px" }}>
                  {[
                    { label: "TOPLAM KM", value: `${formatNumber(totalKm, 0)} km` },
                    { label: "TOPLAM YAKIT", value: `${formatNumber(totalLiters)} L` },
                    { label: "TOPLAM HARCAMA", value: `${formatNumber(totalSpent)} ₺` },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#0f0f1a", padding: "18px 20px" }}>
                      <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#444", marginBottom: "6px" }}>{s.label}</div>
                      <div style={{ fontSize: "20px", fontWeight: "700" }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button onClick={() => { setShowForm(!showForm); setScanError(null); }} style={{
              background: showForm ? "#1a1a2a" : "#ff8c00", color: showForm ? "#ff8c00" : "#000",
              border: "1px solid #ff8c00", padding: "12px 28px", fontSize: "11px", letterSpacing: "3px",
              textTransform: "uppercase", cursor: "pointer", fontFamily: "'Courier New', monospace",
              fontWeight: "700", display: "block", width: "100%", marginBottom: "2px",
            }}>
              {showForm ? "✕ İPTAL" : "+ YENİ KAYIT EKLE"}
            </button>

            {showForm && (
              <div style={{ background: formBg, padding: "24px", border: "1px solid #1e1e2a" }}>

                {/* Receipt Upload */}
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#ff8c00", marginBottom: "10px" }}>📷 FİŞ TARAT (OPSİYONEL)</div>
                  <label style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", background: "#0a0a0f", border: "1px dashed #ff8c00", padding: "16px 20px" }}>
                    <input type="file" accept="image/*" onChange={handleReceiptUpload} style={{ display: "none" }} />
                    {scanning ? (
                      <span style={{ color: "#ff8c00", fontSize: "12px", letterSpacing: "2px" }}>⏳ Fiş taranıyor...</span>
                    ) : receiptImage ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <img src={receiptImage} alt="fiş" style={{ width: "48px", height: "64px", objectFit: "cover", border: "1px solid #ff8c00" }} />
                        <span style={{ color: "#44ff88", fontSize: "12px", letterSpacing: "2px" }}>✓ Fiş tarandı — bilgiler dolduruldu</span>
                      </div>
                    ) : (
                      <span style={{ color: "#555", fontSize: "12px", letterSpacing: "2px" }}>+ Fiş fotoğrafı yükle (AI otomatik doldurur)</span>
                    )}
                  </label>
                  {scanError && <div style={{ color: "#ff4444", fontSize: "11px", marginTop: "8px" }}>⚠ {scanError}</div>}
                </div>

                {/* Form fields */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "12px", marginBottom: "16px" }}>
                  
                  {/* Date field with toggle */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <label style={{ fontSize: "9px", letterSpacing: "3px", color: "#555" }}>TARİH</label>
                      <button onClick={() => setDateMode(dateMode === "picker" ? "manual" : "picker")} style={{
                        background: "none", border: "none", color: "#ff8c00", fontSize: "9px",
                        letterSpacing: "1px", cursor: "pointer", fontFamily: "'Courier New', monospace", padding: 0,
                      }}>
                        {dateMode === "picker" ? "MANUEL GİR" : "TAKVİM"}
                      </button>
                    </div>
                    {dateMode === "picker" ? (
                      <input type="date" value={form.date}
                        onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                        style={{ ...inp, borderColor: form.date ? "#ff8c00" : "#2a2a3a", colorScheme: "dark" }} />
                    ) : (
                      <input type="text" placeholder="GG.AA.YYYY" value={form.date}
                        onChange={e => {
                          // Convert DD.MM.YYYY to YYYY-MM-DD
                          const raw = e.target.value;
                          setForm(p => {
                            const parts = raw.split(".");
                            const iso = parts.length === 3 && parts[2].length === 4
                              ? `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`
                              : raw;
                            return { ...p, date: iso };
                          });
                        }}
                        style={{ ...inp, borderColor: form.date ? "#ff8c00" : "#2a2a3a" }} />
                    )}
                  </div>

                  {/* KM */}
                  <div>
                    <label style={{ fontSize: "9px", letterSpacing: "3px", color: "#555", display: "block", marginBottom: "6px" }}>GÜNCEL KM</label>
                    <NumericInput placeholder="ör. 45.230" value={form.km}
                      onChange={v => setForm(p => ({ ...p, km: v }))}
                      style={{ ...inp, borderColor: form.km ? "#ff8c00" : "#2a2a3a" }} />
                  </div>

                  {/* Liters */}
                  <div>
                    <label style={{ fontSize: "9px", letterSpacing: "3px", color: "#555", display: "block", marginBottom: "6px" }}>ALINAN LİTRE</label>
                    <NumericInput placeholder="ör. 35,5" value={form.liters}
                      onChange={v => setForm(p => ({ ...p, liters: v }))}
                      style={{ ...inp, borderColor: form.liters ? "#ff8c00" : "#2a2a3a" }} />
                  </div>

                  {/* Total price */}
                  <div>
                    <label style={{ fontSize: "9px", letterSpacing: "3px", color: "#555", display: "block", marginBottom: "6px" }}>ÖDENEN TOPLAM ₺</label>
                    <NumericInput placeholder="ör. 1.250,00" value={form.totalPrice}
                      onChange={v => setForm(p => ({ ...p, totalPrice: v }))}
                      style={{ ...inp, borderColor: form.totalPrice ? "#ff8c00" : "#2a2a3a" }} />
                  </div>
                </div>

                <button onClick={handleAdd} disabled={saving || !form.date || !form.km || !form.liters || !form.totalPrice} style={{
                  background: (saving || !form.date || !form.km || !form.liters || !form.totalPrice) ? "#1a1a2a" : "#ff8c00",
                  color: (saving || !form.date || !form.km || !form.liters || !form.totalPrice) ? "#444" : "#000",
                  border: "none", padding: "12px 28px", fontSize: "11px", letterSpacing: "3px",
                  textTransform: "uppercase", cursor: "pointer", fontFamily: "'Courier New', monospace", fontWeight: "900",
                }}>
                  {saving ? "KAYDEDİLİYOR..." : "KAYDET →"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* RECORDS */}
        {!loading && activeTab === "records" && (
          <div>
            {enriched.length === 0 ? (
              <div style={{ color: "#555", textAlign: "center", padding: "48px", fontSize: "13px" }}>Henüz kayıt yok.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {enriched.map((e, i) => (
                  <div key={e.id} style={{
                    background: "#0f0f1a", padding: "16px 20px",
                    display: "grid", gridTemplateColumns: "100px 90px 80px 110px 120px auto auto",
                    gap: "12px", alignItems: "center", borderLeft: i === 0 ? "3px solid #2a2a3a" : "3px solid #ff8c00",
                  }}>
                    {[
                      { label: "TARİH", val: e.date },
                      { label: "KM", val: formatNumber(e.km, 0) },
                      { label: "LİTRE", val: `${formatNumber(e.liters)} L` },
                      { label: "ÖDEME", val: `${formatNumber(e.totalPrice)} ₺` },
                    ].map(col => (
                      <div key={col.label}>
                        <div style={{ fontSize: "9px", color: "#555", letterSpacing: "2px", marginBottom: "3px" }}>{col.label}</div>
                        <div style={{ fontSize: "13px" }}>{col.val}</div>
                      </div>
                    ))}
                    <div>
                      <div style={{ fontSize: "9px", color: "#555", letterSpacing: "2px", marginBottom: "3px" }}>TÜKETİM</div>
                      <div style={{ fontSize: "13px", color: e.consumption ? "#ff8c00" : "#333", fontWeight: e.consumption ? "700" : "400" }}>
                        {e.consumption ? `${formatNumber(e.consumption)} L/100` : "—"}
                      </div>
                    </div>
                    <div style={{ width: "36px" }}>
                      {e.receipt ? (
                        <a href={e.receipt} target="_blank" rel="noopener noreferrer">
                          <img src={e.receipt} alt="fiş" style={{ width: "36px", height: "48px", objectFit: "cover", border: "1px solid #ff8c00", display: "block" }} />
                        </a>
                      ) : (
                        <div style={{ width: "36px", height: "48px", border: "1px dashed #2a2a3a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ color: "#333", fontSize: "10px" }}>—</span>
                        </div>
                      )}
                    </div>
                    <button onClick={() => handleDelete(e.id, e.receipt)} style={{
                      background: "none", border: "1px solid #2a2a3a", color: "#444", cursor: "pointer",
                      padding: "6px 10px", fontSize: "11px", fontFamily: "'Courier New', monospace",
                    }}
                      onMouseEnter={ev => { ev.target.style.borderColor = "#ff4444"; ev.target.style.color = "#ff4444"; }}
                      onMouseLeave={ev => { ev.target.style.borderColor = "#2a2a3a"; ev.target.style.color = "#444"; }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SHELL */}
        {!loading && activeTab === "shell" && (
          <div>
            <div style={{ background: "#0f0f1a", border: "1px solid #1e1e2a", padding: "20px", marginBottom: "20px", borderLeft: "3px solid #ffcc00" }}>
              <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#ffcc00", marginBottom: "8px" }}>ℹ SHELL FİYATLARI</div>
              <div style={{ fontSize: "12px", color: "#555", lineHeight: 1.8 }}>
                Otomatik erişim mümkün değil. Güncel fiyatları manuel girin.<br />
                <a href="https://www.shell.com.tr/suruculer/shell-yakitlari/akaryakit-pompa-satis-fiyatlari.html"
                  target="_blank" rel="noopener noreferrer" style={{ color: "#ffcc00", textDecoration: "none" }}>
                  → Shell akaryakıt fiyatları sayfasını aç ↗
                </a>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "2px", marginBottom: "20px" }}>
              {[{ key: "benzin", label: "BENZİN (95)", emoji: "🟢" }, { key: "motorin", label: "MOTORİN", emoji: "🔵" }, { key: "lpg", label: "LPG", emoji: "🟠" }].map(f => (
                <div key={f.key} style={{ background: "#0f0f1a", padding: "20px" }}>
                  <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#555", marginBottom: "10px" }}>{f.emoji} {f.label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <NumericInput placeholder="0,00" value={shellPrice[f.key]}
                      onChange={v => setShellPrice(p => ({ ...p, [f.key]: v }))}
                      style={{ background: "#0a0a0f", border: "1px solid #2a2a3a", color: "#e8e4d9", padding: "10px 12px", fontSize: "18px", fontWeight: "900", width: "100%", fontFamily: "'Courier New', monospace", outline: "none", boxSizing: "border-box" }} />
                    <span style={{ color: "#555" }}>₺</span>
                  </div>
                  {shellPrice[f.key] && (
                    <div style={{ marginTop: "8px", fontSize: "11px", color: "#ff8c00" }}>
                      ✓ {formatNumber(parseTR(shellPrice[f.key]))} ₺/L
                    </div>
                  )}
                </div>
              ))}
            </div>
            {shellPrice.benzin && avgLiterPrice > 0 && (
              <div style={{ background: "#0f0f1a", padding: "20px", borderLeft: "3px solid #ff8c00" }}>
                <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#555", marginBottom: "12px" }}>KARŞILAŞTIRMA</div>
                <div style={{ fontSize: "13px", lineHeight: 2 }}>
                  <span style={{ color: "#555" }}>Ortalama ödediğin:</span> <span style={{ color: "#ff8c00", fontWeight: "700" }}>{formatNumber(avgLiterPrice)} ₺/L</span><br />
                  <span style={{ color: "#555" }}>Shell 95 fiyatı:</span> <span style={{ color: "#ffcc00", fontWeight: "700" }}>{formatNumber(parseTR(shellPrice.benzin))} ₺/L</span><br />
                  <span style={{ color: "#555" }}>Fark:</span>{" "}
                  <span style={{ color: avgLiterPrice < parseTR(shellPrice.benzin) ? "#44ff88" : "#ff4444", fontWeight: "700" }}>
                    {formatNumber(avgLiterPrice - parseTR(shellPrice.benzin))} ₺/L
                    {avgLiterPrice < parseTR(shellPrice.benzin) ? " (daha ucuza aldın ✓)" : " (Shell'den pahalıya aldın)"}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: "40px", paddingTop: "16px", borderTop: "1px solid #1a1a2a", fontSize: "9px", color: "#333", letterSpacing: "2px", textAlign: "center" }}>
          FUEL TRACKER — {entries.length} KAYIT — SUPABASE
        </div>
      </div>
    </div>
  );
}
