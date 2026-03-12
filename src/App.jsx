import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://delljhepbcevggfokcwy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbGxqaGVwYmNldmdnZm9rY3d5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODAzNDgsImV4cCI6MjA4ODU1NjM0OH0.HIgJdaZ0pk7uRNBYMuW4kkBlTlZoXcxQP74f8J_s6SU";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const FONT = "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif";
const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace";

const MAINT_CATEGORIES = [
  { id: "lastik", label: "Lastik", color: "#ffdd00", emoji: "🛞" },
  { id: "silecek", label: "Silecek", color: "#64d2ff", emoji: "🌧️" },
  { id: "fren", label: "Fren", color: "#ff6655", emoji: "🛑" },
  { id: "genel", label: "Genel Servis", color: "#44cc88", emoji: "🔧" },
];



const TANK_SIZE = 40; // litre

// Her dolumdan sonra ağırlıklı ortalama fiyatı hesaplar
// tam dolu doldurulduğu varsayılır → kalan = TANK_SIZE - alınan
function computeWeightedHistory(entries) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
  let avgPrice = 0;
  return sorted.map(e => {
    const liters = e.liters || 0;
    const price = e.liters > 0 ? e.totalPrice / e.liters : 0;
    if (liters > 0 && avgPrice === 0) {
      // İlk dolum
      avgPrice = price;
    } else if (liters > 0) {
      const remaining = Math.max(0, TANK_SIZE - liters);
      avgPrice = (remaining * avgPrice + liters * price) / TANK_SIZE;
    }
    return { ...e, avgPrice: avgPrice > 0 ? avgPrice : price };
  });
}

// Belirli bir km'deki ağırlıklı ortalama fiyatı bul
function getWeightedPriceAtKm(history, km) {
  const before = history.filter(e => e.km <= km);
  if (before.length === 0) return null;
  return before[before.length - 1].avgPrice;
}

// Yolculuk toplam yakıt maliyeti (weighted avg ile)
function calcTripFuelCost(history, startKm, endKm, consumption) {
  const km = endKm - startKm;
  if (km <= 0 || !consumption) return null;
  
  // Başlangıçtaki ağırlıklı ortalama fiyat
  const startPrice = getWeightedPriceAtKm(history, startKm);
  if (!startPrice) return null;

  // Bu km aralığındaki dolumlar
  const fills = history.filter(e => e.km > startKm && e.km <= endKm && e.liters > 0);
  
  if (fills.length === 0) {
    // Hiç dolum yok - başlangıç fiyatıyla hesapla
    const liters = (km * consumption) / 100;
    return { cost: liters * startPrice, avgPrice: startPrice, liters, segments: [] };
  }

  // Her segment için ayrı hesap
  let totalCost = 0;
  let totalLiters = 0;
  const segments = [];
  let prevKm = startKm;
  let curPrice = startPrice;

  for (const fill of fills) {
    const segKm = fill.km - prevKm;
    const segLiters = (segKm * consumption) / 100;
    const segCost = segLiters * curPrice;
    totalCost += segCost;
    totalLiters += segLiters;
    segments.push({ km: segKm, liters: segLiters, price: curPrice, cost: segCost });
    curPrice = fill.avgPrice; // dolumdan sonra güncel fiyat
    prevKm = fill.km;
  }

  // Son segment (son dolumdan bitişe)
  const lastKm = endKm - prevKm;
  if (lastKm > 0) {
    const lastLiters = (lastKm * consumption) / 100;
    const lastCost = lastLiters * curPrice;
    totalCost += lastCost;
    totalLiters += lastLiters;
    segments.push({ km: lastKm, liters: lastLiters, price: curPrice, cost: lastCost });
  }

  return { cost: totalCost, avgPrice: totalCost / totalLiters, liters: totalLiters, segments };
}

function downloadCSV(rows, filename) {
  const header = ["Tarih","Km","Litre","Toplam ₺","₺/Litre","L/100km","₺/Km"];
  const lines = [header.join(";"), ...rows.map(e => [
    fmtDate(e.date),
    String(Math.round(e.km)),
    e.liters.toFixed(2).replace(".",","),
    e.totalPrice.toFixed(2).replace(".",","),
    (e.totalPrice/e.liters).toFixed(4).replace(".",","),
    e.l100km !== null ? e.l100km.toFixed(2).replace(".",",") : "",
    e.costPerKm !== null ? e.costPerKm.toFixed(4).replace(".",",") : "",
  ].join(";"))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

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
const fmtDate = (iso) => { if (!iso) return ""; const [y,m,d] = iso.split("-"); return `${d}.${m}.${y}`; };
const parseDateInput = (val) => {
  // DD.MM.YYYY → YYYY-MM-DD
  const parts = val.replace(/[^0-9]/g, "");
  if (parts.length >= 8) {
    const d = parts.slice(0,2), m = parts.slice(2,4), y = parts.slice(4,8);
    return `${y}-${m}-${d}`;
  }
  return "";
};
const fmtDateInput = (iso) => {
  if (!iso) return "";
  const [y,m,d] = iso.split("-");
  return `${d}.${m}.${y}`;
};
const toTR = (num) => {
  if (!num && num !== 0) return "";
  const [int, dec] = num.toFixed(2).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + dec;
};
const emptyForm = () => ({ date: new Date().toISOString().split("T")[0], km: "", liters: "", totalPrice: "" });
const emptyMaint = () => ({ date: new Date().toISOString().split("T")[0], km: "", category: "lastik", description: "", cost: "" });
const emptyTrip = () => ({ date: new Date().toISOString().split("T")[0], tripDateFrom: "", tripDateTo: "", title: "", startKm: "", endKm: "", consumption: "", fuelPrice: "", tollItems: [], tollCost: "", notes: "", consumptionMode: "manual", tankPercent: "100" });

export default function FuelTracker() {
  // Fuel
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [shellPrice, setShellPrice] = useState({ benzin: "", motorin: "" });
  const [showForm, setShowForm] = useState(false);
  const [receiptImage, setReceiptImage] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dateMode, setDateMode] = useState("picker");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editReceiptFile, setEditReceiptFile] = useState(null);
  const [editReceiptPreview, setEditReceiptPreview] = useState(null);
  const [filterMonth, setFilterMonth] = useState("all");
  const [fetchError, setFetchError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [editError, setEditError] = useState(null);
  const [panelFrom, setPanelFrom] = useState("");
  const [panelTo, setPanelTo] = useState("");
  // CSV
  const [csvFrom, setCsvFrom] = useState("");
  const [csvTo, setCsvTo] = useState("");
  const [showCsvOptions, setShowCsvOptions] = useState(false);
  const [csvMode, setCsvMode] = useState("range"); // range | month
  const [csvMonth, setCsvMonth] = useState("");
  // Gemini
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");

  // EPDK
  const [epdkData, setEpdkData] = useState(null);
  const [userIl, setUserIl] = useState("bursa");
  const [userIlce, setUserIlce] = useState("");
  const [epdkLoading, setEpdkLoading] = useState(false);
  const [epdkError, setEpdkError] = useState(null);

  // Tabs
  const [activeTab, setActiveTab] = useState("dashboard");
  const [fuelSubTab, setFuelSubTab] = useState("records"); // records | monthly | prices

  // Maintenance
  const [maintEntries, setMaintEntries] = useState([]);
  const [maintForm, setMaintForm] = useState(emptyMaint());
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [maintSaving, setMaintSaving] = useState(false);
  const [maintLoading, setMaintLoading] = useState(false);
  const [editingMaintId, setEditingMaintId] = useState(null);
  const [editMaintForm, setEditMaintForm] = useState({});
  const [editMaintSaving, setEditMaintSaving] = useState(false);

  // Vehicle info
  const [vehicleInfo, setVehicleInfo] = useState(null);
  const [vehicleForm, setVehicleForm] = useState({ purchase_date: "", purchase_km: "0" });
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [vehicleSaving, setVehicleSaving] = useState(false);

  // Trips
  const [tripEntries, setTripEntries] = useState([]);
  const [tripForm, setTripForm] = useState(emptyTrip());
  const [showTripForm, setShowTripForm] = useState(false);
  const [tripSaving, setTripSaving] = useState(false);
  const [tripLoading, setTripLoading] = useState(false);
  const [editingTripId, setEditingTripId] = useState(null);
  const [editTripForm, setEditTripForm] = useState({});
  const [editTripSaving, setEditTripSaving] = useState(false);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    fetchEntries();
    fetchMaintEntries();
    fetchTripEntries();
    fetchVehicleInfo();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(() => fetchEpdk(true), () => fetchEpdk(false), { timeout: 6000 });
    } else {
      fetchEpdk(false);
    }
  }, []);

  // --- EPDK ---
  const getLocationInfo = async (lat, lon) => {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=tr`, { headers: { "User-Agent": "FuelTrackerApp/1.0" } });
    const json = await r.json();
    const il = json.address?.province || json.address?.state || json.address?.city || "bursa";
    const ilce = json.address?.county || json.address?.district || json.address?.town || json.address?.municipality || json.address?.suburb || "";
    return { il, ilce };
  };

  const fetchEpdk = async (useLocation = false) => {
    setEpdkLoading(true); setEpdkError(null); setEpdkData(null);
    try {
      let il = userIl, ilce = userIlce;
      if (useLocation) {
        const coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), e => reject(e), { timeout: 8000 }));
        const info = await getLocationInfo(coords.lat, coords.lon);
        il = info.il; ilce = info.ilce;
        setUserIl(il); setUserIlce(ilce);
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

  // --- FUEL ---
  const fetchEntries = async () => {
    setLoading(true); setFetchError(null);
    const { data, error } = await supabase.from("fuel_entries").select("*").order("date", { ascending: true }).order("created_at", { ascending: true });
    if (error) { setFetchError("Kayıtlar yüklenemedi."); }
    else if (data) {
      setEntries(data.map(e => ({ id: e.id, date: e.date, km: parseFloat(e.km), liters: parseFloat(e.liters), totalPrice: parseFloat(e.total_price), receipt: e.receipt_url || null })));
    }
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!form.date || !form.km || !form.liters || !form.totalPrice) return;
    setSaving(true); setSaveError(null);
    try {
      let receiptUrl = null;
      if (receiptFile) {
        const fileName = `${Date.now()}_${receiptFile.name}`;
        const { error: uploadError } = await supabase.storage.from("receipts").upload(fileName, receiptFile, { contentType: receiptFile.type });
        if (!uploadError) { const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(fileName); receiptUrl = urlData.publicUrl; }
      }
      const { error } = await supabase.from("fuel_entries").insert({ date: form.date, km: parseTR(form.km), liters: parseTR(form.liters), total_price: parseTR(form.totalPrice), receipt_url: receiptUrl });
      if (error) { setSaveError("Kayıt eklenemedi."); }
      else { await fetchEntries(); setForm(emptyForm()); setReceiptImage(null); setReceiptFile(null); setShowForm(false); }
    } catch (e) { setSaveError("Beklenmeyen bir hata oluştu."); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id, receipt) => {
    setDeleteError(null);
    try {
      if (receipt) await supabase.storage.from("receipts").remove([receipt.split("/").pop()]);
      const { error } = await supabase.from("fuel_entries").delete().eq("id", id);
      if (error) setDeleteError("Kayıt silinemedi.");
      else await fetchEntries();
    } catch (e) { setDeleteError("Beklenmeyen bir hata oluştu."); }
  };

  const startEdit = (e) => {
    setEditingId(e.id); setEditReceiptFile(null); setEditReceiptPreview(e.receipt || null);
    setEditForm({ date: e.date, km: String(Math.round(e.km)).replace(/\B(?=(\d{3})+(?!\d))/g, "."), liters: toTR(e.liters), totalPrice: toTR(e.totalPrice), receipt: e.receipt || null });
  };

  const handleEditSave = async () => {
    if (!editForm.date || !editForm.km || !editForm.liters || !editForm.totalPrice) return;
    setEditSaving(true); setEditError(null);
    try {
      let receiptUrl = editForm.receipt || null;
      if (editReceiptFile) {
        const fileName = `${Date.now()}_${editReceiptFile.name}`;
        const { error: uploadError } = await supabase.storage.from("receipts").upload(fileName, editReceiptFile, { contentType: editReceiptFile.type });
        if (!uploadError) { const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(fileName); receiptUrl = urlData.publicUrl; }
      }
      const { error } = await supabase.from("fuel_entries").update({ date: editForm.date, km: parseTR(editForm.km), liters: parseTR(editForm.liters), total_price: parseTR(editForm.totalPrice), receipt_url: receiptUrl }).eq("id", editingId);
      if (error) setEditError("Kayıt güncellenemedi.");
      else { await fetchEntries(); setEditingId(null); }
    } catch (e) { setEditError("Beklenmeyen bir hata oluştu."); }
    finally { setEditSaving(false); }
  };

  // --- MAINTENANCE ---
  const fetchMaintEntries = async () => {
    setMaintLoading(true);
    const { data, error } = await supabase.from("maintenance_entries").select("*").order("date", { ascending: false });
    if (!error && data) {
      setMaintEntries(data.map(e => ({ id: e.id, date: e.date, km: parseFloat(e.km), category: e.category, description: e.description || "", cost: parseFloat(e.cost), receipt: e.receipt_url || null, receipts: e.receipt_urls || [] })));
    }
    setMaintLoading(false);
  };

  const [maintReceiptFiles, setMaintReceiptFiles] = useState([]);
  const [maintReceiptPreviews, setMaintReceiptPreviews] = useState([]);
  const [editMaintReceiptFiles, setEditMaintReceiptFiles] = useState([]);
  const [editMaintReceiptPreviews, setEditMaintReceiptPreviews] = useState([]);
  const [tripReceiptFiles, setTripReceiptFiles] = useState([]);
  const [showTollAdder, setShowTollAdder] = useState(false);
  const [tollAddValue, setTollAddValue] = useState("");
  const [tollAddLabel, setTollAddLabel] = useState("");
  const [editTollAddLabel, setEditTollAddLabel] = useState("");
  const [showEditTollAdder, setShowEditTollAdder] = useState(false);
  const [editTollAddValue, setEditTollAddValue] = useState("");
  const [tripReceiptPreviews, setTripReceiptPreviews] = useState([]);
  const [editTripReceiptFiles, setEditTripReceiptFiles] = useState([]);
  const [editTripReceiptPreviews, setEditTripReceiptPreviews] = useState([]);

  const handleAddMaint = async () => {
    if (!maintForm.date || !maintForm.km || !maintForm.cost) return;
    setMaintSaving(true);
    try {
      const urls = await uploadMultipleFiles(maintReceiptFiles);
      const { error } = await supabase.from("maintenance_entries").insert({ date: maintForm.date, km: parseTR(maintForm.km), category: maintForm.category, description: maintForm.description, cost: parseTR(maintForm.cost), receipt_urls: urls });
      if (!error) { await fetchMaintEntries(); setMaintForm(emptyMaint()); setMaintReceiptFiles([]); setMaintReceiptPreviews([]); setShowMaintForm(false); }
    } finally { setMaintSaving(false); }
  };

  const handleDeleteMaint = async (id) => {
    await supabase.from("maintenance_entries").delete().eq("id", id);
    await fetchMaintEntries();
  };

  const startEditMaint = (e) => {
    setEditingMaintId(e.id);
    setEditMaintReceiptFiles([]);
    setEditMaintReceiptPreviews([]);
    setEditMaintForm({ date: e.date, km: String(Math.round(e.km)).replace(/\B(?=(\d{3})+(?!\d))/g, "."), category: e.category, description: e.description, cost: toTR(e.cost), existingReceipts: e.receipts || (e.receipt ? [e.receipt] : []) });
  };

  const handleEditMaintSave = async () => {
    setEditMaintSaving(true);
    try {
      const newUrls = await uploadMultipleFiles(editMaintReceiptFiles);
      const allUrls = [...(editMaintForm.existingReceipts || []), ...newUrls];
      const { error } = await supabase.from("maintenance_entries").update({ date: editMaintForm.date, km: parseTR(editMaintForm.km), category: editMaintForm.category, description: editMaintForm.description, cost: parseTR(editMaintForm.cost), receipt_urls: allUrls }).eq("id", editingMaintId);
      if (!error) { await fetchMaintEntries(); setEditingMaintId(null); }
    } finally { setEditMaintSaving(false); }
  };



  const analyzeReceiptWithGemini = async (file) => {
    if (!geminiKey) { setShowGeminiKey(true); return; }
    setGeminiLoading(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: 'Bu bir akaryakıt pompası veya istasyon fişidir. Fişten şu bilgileri çıkar ve SADECE JSON olarak yanıtla (başka hiçbir şey yazma): {"tarih": "YYYY-MM-DD formatında tarih veya boş string", "litre": sayı veya null, "toplam": sayı veya null, "km": sayı veya null}. Tarih bulamazsan bugünün tarihini kullan.' },
            { inline_data: { mime_type: file.type, data: base64 } }
          ]}]
        })
      });
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setForm(p => ({
        ...p,
        ...(parsed.tarih ? { date: parsed.tarih } : {}),
        ...(parsed.litre ? { liters: toTR(parsed.litre) } : {}),
        ...(parsed.litre_fiyati ? { totalPrice: parsed.toplam ? toTR(parsed.toplam) : toTR(parsed.litre * parsed.litre_fiyati) } : {}),
        ...(parsed.toplam ? { totalPrice: toTR(parsed.toplam) } : {}),
      }));
    } catch(e) {
      console.error("Gemini hata:", e);
    } finally { setGeminiLoading(false); }
  };

  const uploadMultipleFiles = async (files) => {
    const urls = [];
    for (const file of files) {
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`;
      const { error } = await supabase.storage.from("receipts").upload(fileName, file, { contentType: file.type });
      if (!error) {
        const { data } = supabase.storage.from("receipts").getPublicUrl(fileName);
        urls.push(data.publicUrl);
      }
    }
    return urls;
  };

  // --- VEHICLE INFO ---
  const fetchVehicleInfo = async () => {
    const { data } = await supabase.from("vehicle_info").select("*").limit(1);
    if (data && data.length > 0) setVehicleInfo(data[0]);
  };

  const handleSaveVehicle = async () => {
    setVehicleSaving(true);
    try {
      if (vehicleInfo) {
        await supabase.from("vehicle_info").update({ purchase_date: vehicleForm.purchase_date, purchase_km: parseTR(vehicleForm.purchase_km) }).eq("id", vehicleInfo.id);
      } else {
        await supabase.from("vehicle_info").insert({ purchase_date: vehicleForm.purchase_date, purchase_km: parseTR(vehicleForm.purchase_km), service_interval_months: 12, service_interval_km: 15000 });
      }
      await fetchVehicleInfo();
      setShowVehicleForm(false);
    } finally { setVehicleSaving(false); }
  };

  // --- TRIPS ---
  const fetchTripEntries = async () => {
    setTripLoading(true);
    const { data, error } = await supabase.from("trip_entries").select("*").order("date", { ascending: false });
    if (!error && data) {
      setTripEntries(data.map(e => { const items = e.toll_items ? (typeof e.toll_items === "string" ? JSON.parse(e.toll_items) : e.toll_items) : []; return { id: e.id, date: e.date, title: e.title || "", startKm: parseFloat(e.start_km), endKm: parseFloat(e.end_km), consumption: parseFloat(e.consumption), fuelPrice: parseFloat(e.fuel_price), tollCost: items.reduce((s,i) => s + i.amount, 0) || parseFloat(e.toll_cost || 0), tollItems: items, notes: e.notes || "", receipts: e.receipt_urls || [] }; }));
    }
    setTripLoading(false);
  };

  const handleAddTrip = async () => {
    if (!tripForm.date || !tripForm.startKm || !tripForm.endKm || !tripForm.consumption || !tripForm.fuelPrice) return;
    setTripSaving(true);
    try {
      const urls = await uploadMultipleFiles(tripReceiptFiles);
      const tollTotal = tripForm.tollItems.reduce((s,i) => s + i.amount, 0); const wacResult = calcTripFuelCost(weightedHistory, parseTR(tripForm.startKm), parseTR(tripForm.endKm), parseTR(tripForm.consumption)); const effectivePrice = wacResult ? wacResult.avgPrice : parseTR(tripForm.fuelPrice); const { error } = await supabase.from("trip_entries").insert({ date: tripForm.date, title: tripForm.title, start_km: parseTR(tripForm.startKm), end_km: parseTR(tripForm.endKm), consumption: parseTR(tripForm.consumption), fuel_price: effectivePrice, toll_cost: tollTotal, toll_items: JSON.stringify(tripForm.tollItems), notes: tripForm.notes, receipt_urls: urls });
      if (!error) { await fetchTripEntries(); setTripForm(emptyTrip()); setTripReceiptFiles([]); setTripReceiptPreviews([]); setShowTripForm(false); }
    } finally { setTripSaving(false); }
  };

  const handleDeleteTrip = async (id) => {
    await supabase.from("trip_entries").delete().eq("id", id);
    await fetchTripEntries();
  };

  const startEditTrip = (e) => {
    setEditingTripId(e.id);
    setEditTripReceiptFiles([]);
    setEditTripReceiptPreviews([]);
    setEditTripForm({ date: e.date, title: e.title, startKm: String(Math.round(e.startKm)).replace(/\B(?=(\d{3})+(?!\d))/g, "."), endKm: String(Math.round(e.endKm)).replace(/\B(?=(\d{3})+(?!\d))/g, "."), consumption: toTR(e.consumption), fuelPrice: toTR(e.fuelPrice), tollCost: toTR(e.tollCost), tollItems: e.tollItems || [], notes: e.notes, existingReceipts: e.receipts || [], consumptionMode: "manual", tankPercent: "100" });
  };

  const handleEditTripSave = async () => {
    setEditTripSaving(true);
    try {
      const newUrls = await uploadMultipleFiles(editTripReceiptFiles);
      const allUrls = [...(editTripForm.existingReceipts || []), ...newUrls];
      const tollTotal2 = (editTripForm.tollItems || []).reduce((s,i) => s + i.amount, 0); const { error } = await supabase.from("trip_entries").update({ date: editTripForm.date, title: editTripForm.title, start_km: parseTR(editTripForm.startKm), end_km: parseTR(editTripForm.endKm), consumption: parseTR(editTripForm.consumption), fuel_price: parseTR(editTripForm.fuelPrice), toll_cost: tollTotal2, toll_items: JSON.stringify(editTripForm.tollItems || []), notes: editTripForm.notes, receipt_urls: allUrls }).eq("id", editingTripId);
      if (!error) { await fetchTripEntries(); setEditingTripId(null); }
    } finally { setEditTripSaving(false); }
  };

  // --- COMPUTED ---
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

  const totalMaintCost = maintEntries.reduce((s, e) => s + e.cost, 0);

  // Ağırlıklı ortalama fiyat geçmişi
  const weightedHistory = computeWeightedHistory(entries);
  const currentWAC = weightedHistory.length > 0 ? weightedHistory[weightedHistory.length - 1].avgPrice : null;

  const enriched = entries.map((e, i) => {
    const wh = weightedHistory.find(w => w.id === e.id);
    if (i === 0) return { ...e, consumption: null, avgPrice: wh?.avgPrice || null };
    const dist = e.km - entries[i - 1].km;
    return { ...e, consumption: dist > 0 ? (e.liters / dist) * 100 : null, avgPrice: wh?.avgPrice || null };
  });

  // Service countdown
  const getServiceStatus = () => {
    if (!vehicleInfo) return null;
    const now = new Date();
    const purchaseDate = new Date(vehicleInfo.purchase_date);
    const intMonths = vehicleInfo.service_interval_months || 12;
    const intKm = vehicleInfo.service_interval_km || 15000;
    const lastMaint = maintEntries.filter(e => e.category === "genel").length > 0 ? [...maintEntries.filter(e => e.category === "genel")].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
    const baseDate = lastMaint ? new Date(lastMaint.date) : purchaseDate;
    const baseKm = lastMaint ? lastMaint.km : parseFloat(vehicleInfo.purchase_km || 0);
    const nextDate = new Date(baseDate);
    nextDate.setMonth(nextDate.getMonth() + intMonths);
    const nextKm = baseKm + intKm;
    const fuelAfterService = entries.filter(e => e.date >= (lastMaint ? lastMaint.date : vehicleInfo.purchase_date));
    const currentKm = fuelAfterService.length > 0 ? fuelAfterService[fuelAfterService.length - 1].km : (lastMaint ? lastMaint.km : parseFloat(vehicleInfo.purchase_km || 0));
    const daysLeft = Math.ceil((nextDate - now) / (1000 * 60 * 60 * 24));
    const kmLeft = nextKm - currentKm;
    const isUrgent = daysLeft < 30 || kmLeft < 1500;
    const isOverdue = daysLeft < 0 || kmLeft < 0;
    return { daysLeft, kmLeft, nextDate: nextDate.toLocaleDateString("tr-TR"), nextKm: Math.round(nextKm), isUrgent, isOverdue };
  };
  const serviceStatus = getServiceStatus();

  // Trip calc helper - weighted avg cost kullanır
  const calcTrip = (t) => {
    const km = t.endKm - t.startKm;
    const liters = (km * t.consumption) / 100;
    const wac = calcTripFuelCost(weightedHistory, t.startKm, t.endKm, t.consumption);
    const fuelCost = wac ? wac.cost : liters * t.fuelPrice;
    const avgPrice = wac ? wac.avgPrice : t.fuelPrice;
    const total = fuelCost + (t.tollCost || 0);
    return { km, liters, fuelCost, avgPrice, total, wac };
  };

  // Styles
  const inp = { background: "#111e30", border: "1px solid #1a2a45", color: "#e8eef8", padding: "0 12px", width: "100%", maxWidth: "100%", fontSize: "13px", fontFamily: FONT, outline: "none", boxSizing: "border-box", borderRadius: "6px", display: "flex", alignItems: "center", height: "44px", textAlign: "left" };
  const editInp = { background: "#080c14", border: "1px solid #64d2ff", color: "#e8eef8", padding: "6px 10px", width: "100%", maxWidth: "100%", minWidth: 0, fontSize: "13px", fontFamily: MONO, outline: "none", boxSizing: "border-box", borderRadius: "5px", fontWeight: "700", WebkitAppearance: "none", appearance: "none", display: "block" };
  const lbl = { fontSize: "10px", letterSpacing: "1px", color: "#4a6080", display: "block", marginBottom: "6px", fontWeight: "600", textTransform: "uppercase", fontFamily: FONT };

  const monthName = (key) => {
    const [y, m] = key.split("-");
    const names = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
    return `${names[parseInt(m) - 1]} ${y}`;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#080c14", color: "#e8eef8", fontFamily: FONT, overflowX: "clip" }}>
      <meta name="theme-color" content="#080c14" />
      <style>{`body { background: #080c14 !important; margin: 0; }`}</style>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <style>{`
        input[type="date"] { -webkit-appearance: none; appearance: none; width: 100% !important; max-width: 100% !important; min-width: 0 !important; box-sizing: border-box !important; display: flex !important; align-items: center !important; height: 44px !important; line-height: 44px !important; font-size: 12px !important; padding-top: 0 !important; padding-bottom: 0 !important; }
        input, select, textarea { font-size: 16px !important; }
        * { box-sizing: border-box; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        button { transition: all 0.15s ease; }
        .card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .card:active { transform: scale(0.99); }
        select { background: #111e30; border: 1px solid #1a2a45; color: #e8eef8; padding: 10px 12px; width: 100%; font-size: 14px; font-family: ${FONT}; outline: none; border-radius: 6px; appearance: none; }
      `}</style>
      <div style={{ position: "relative", zIndex: 1, maxWidth: "860px", margin: "0 auto", padding: "24px 16px 110px 16px" }}>

        <div style={{ marginBottom: "28px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#64d2ff", marginBottom: "6px", fontWeight: "600" }}>🚗 ARAÇ TAKİP</div>
          <h1 style={{ fontSize: "clamp(26px,5vw,42px)", fontWeight: "900", margin: 0, letterSpacing: "-1px", lineHeight: 1.1 }}>
            Fuel <span style={{ color: "#64d2ff" }}>Tracker</span>
          </h1>
        </div>

        {loading && <div style={{ textAlign: "center", padding: "48px", color: "#4a6080", fontSize: "13px" }}>Yükleniyor...</div>}
        {!loading && fetchError && (
          <div style={{ background: "#0a0a1a", border: "1px solid #ff4444", borderRadius: "10px", padding: "16px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <span style={{ color: "#ff4444", fontSize: "13px" }}>⚠ {fetchError}</span>
            <button onClick={fetchEntries} style={{ background: "transparent", border: "1px solid #ff4444", color: "#ff4444", padding: "6px 14px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>Tekrar Dene</button>
          </div>
        )}

        {/* ===== PANEL ===== */}
        {!loading && activeTab === "dashboard" && (
          <div>
            {/* Bakım sayacı */}
            {serviceStatus && (
              <div className="card" style={{ background: "#0f1829", borderRadius: "12px", padding: "14px 16px", marginBottom: "12px", borderLeft: `3px solid ${serviceStatus.isOverdue ? "#ff4444" : serviceStatus.isUrgent ? "#ffdd00" : "#44cc88"}` }}>
                <div style={{ fontSize: "10px", fontWeight: "700", color: serviceStatus.isOverdue ? "#ff4444" : serviceStatus.isUrgent ? "#ffdd00" : "#44cc88", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
                  {serviceStatus.isOverdue ? "🔴 Bakım Süresi Geçti!" : serviceStatus.isUrgent ? "🟡 Bakım Yaklaşıyor" : "🔧 Sonraki Bakım"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <div style={{ fontSize: "9px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>Kalan Gün</div>
                    <div style={{ fontSize: "20px", fontWeight: "800", fontFamily: MONO, color: serviceStatus.isOverdue ? "#ff4444" : "#e8eef8", fontVariantNumeric: "tabular-nums" }}>{serviceStatus.daysLeft < 0 ? `+${Math.abs(serviceStatus.daysLeft)}` : serviceStatus.daysLeft}</div>
                    <div style={{ fontSize: "10px", color: "#4a6080" }}>{serviceStatus.nextDate}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "9px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>Kalan Km</div>
                    <div style={{ fontSize: "20px", fontWeight: "800", fontFamily: MONO, color: serviceStatus.kmLeft < 0 ? "#ff4444" : "#e8eef8", fontVariantNumeric: "tabular-nums" }}>{serviceStatus.kmLeft < 0 ? `+${formatNumber(Math.abs(serviceStatus.kmLeft), 0)}` : formatNumber(serviceStatus.kmLeft, 0)}</div>
                    <div style={{ fontSize: "10px", color: "#4a6080" }}>{formatNumber(serviceStatus.nextKm, 0)} km'de</div>
                  </div>
                </div>
              </div>
            )}

            {!vehicleInfo && (
              <div style={{ background: "#0f1829", border: "1px dashed #1a2a45", borderRadius: "10px", padding: "16px", marginBottom: "12px", textAlign: "center" }}>
                <div style={{ fontSize: "13px", color: "#4a6080", marginBottom: "10px" }}>Bakım sayacı için araç bilgilerini gir</div>
                <button onClick={() => { setVehicleForm({ purchase_date: "", purchase_km: "0" }); setShowVehicleForm(true); }} style={{ background: "#64d2ff", color: "#000", border: "none", padding: "8px 20px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>
                  + Araç Bilgisi Ekle
                </button>
              </div>
            )}

            {vehicleInfo && (
              <div style={{ marginBottom: "12px", display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => { setVehicleForm({ purchase_date: vehicleInfo.purchase_date, purchase_km: String(vehicleInfo.purchase_km) }); setShowVehicleForm(true); }} style={{ background: "none", border: "1px solid #1a2a45", color: "#4a6080", padding: "5px 12px", fontSize: "11px", cursor: "pointer", fontFamily: FONT, borderRadius: "20px" }}>⚙ Araç Bilgisi</button>
              </div>
            )}

            {showVehicleForm && (
              <div style={{ background: "#0d1524", border: "1px solid #1a2a45", borderRadius: "12px", padding: "16px", marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#64d2ff", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>Araç Bilgisi</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                  <div><div style={lbl}>Alış Tarihi</div><input type="date" value={vehicleForm.purchase_date} onChange={e => setVehicleForm(p => ({ ...p, purchase_date: e.target.value }))} style={{ ...inp, colorScheme: "dark" }} /></div>
                  <div><div style={lbl}>Alış Km</div><NumericInput value={vehicleForm.purchase_km} onChange={v => setVehicleForm(p => ({ ...p, purchase_km: v }))} placeholder="0" style={inp} /></div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={handleSaveVehicle} disabled={vehicleSaving} style={{ background: "#64d2ff", color: "#000", border: "none", padding: "8px 20px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>{vehicleSaving ? "Kaydediliyor..." : "Kaydet ✓"}</button>
                  <button onClick={() => setShowVehicleForm(false)} style={{ background: "transparent", color: "#888", border: "1px solid #1a2a45", padding: "8px 16px", fontSize: "12px", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>İptal</button>
                </div>
              </div>
            )}

            {entries.length >= 2 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", marginBottom: "12px", alignItems: "end" }}>
                <div>
                  <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Başlangıç</div>
                  <input type="date" value={panelFrom} onChange={e => setPanelFrom(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                </div>
                <div>
                  <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Bitiş</div>
                  <input type="date" value={panelTo} onChange={e => setPanelTo(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                </div>
                <button onClick={() => { setPanelFrom(""); setPanelTo(""); }} style={{ background: "none", border: "1px solid #1a2a45", color: panelFrom || panelTo ? "#64d2ff" : "#1a2a45", fontSize: "13px", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", width: "38px", height: "38px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
            )}

            {entries.length >= 2 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px", marginBottom: "8px" }}>
                {[
                  { label: "L / 100 km", val: formatNumber(avg100km) },
                  { label: "₺ / km", val: formatNumber(avgPerKm) },
                  { label: "₺ / litre (WAC)", val: currentWAC ? formatNumber(currentWAC) : formatNumber(avgLiterPrice) },
                ].map(s => (
                  <div key={s.label} className="card" style={{ background: "#0f1829", borderRadius: "12px", padding: "14px 12px", borderTop: "2px solid #64d2ff" }}>
                    <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>{s.label}</div>
                    <div style={{ fontSize: "14px", fontWeight: "800", color: "#64d2ff", fontFamily: MONO, lineHeight: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px", marginBottom: "12px" }}>
                {[
                  { label: "Toplam km", val: formatNumber(totalKm, 0), border: "#8aa4c8" },
                  { label: "Toplam litre", val: formatNumber(totalLiters), border: "#8aa4c8" },
                  { label: "Yakıt Maliyeti", val: `${formatNumber(totalSpent)} ₺`, border: "#8aa4c8" },
                ].map(s => (
                  <div key={s.label} className="card" style={{ background: "#0f1829", borderRadius: "12px", padding: "14px 12px", borderTop: `2px solid ${s.border}` }}>
                    <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>{s.label}</div>
                    <div style={{ fontSize: "14px", fontWeight: "700", color: "#e8eef8", fontFamily: MONO, lineHeight: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "8px", marginBottom: "20px" }}>
                <div className="card" style={{ background: "#0f1829", borderRadius: "12px", padding: "14px 12px", borderTop: "2px solid #ffdd00" }}>
                  <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Bakım Maliyeti</div>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "#ffdd00", fontFamily: MONO, lineHeight: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatNumber(totalMaintCost)} ₺</div>
                </div>
                <div className="card" style={{ background: "#0f1829", borderRadius: "12px", padding: "14px 12px", borderTop: "2px solid #ff6655" }}>
                  <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Toplam Maliyet</div>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "#ff6655", fontFamily: MONO, lineHeight: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatNumber(totalSpent + totalMaintCost)} ₺</div>
                </div>
              </div>
            </>)}

            {entries.length < 2 && (
              <div style={{ background: "#0f1829", border: "1px dashed #1a2a45", borderRadius: "10px", padding: "32px", textAlign: "center", marginBottom: "20px" }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>⛽</div>
                <div style={{ color: "#4a6080", fontSize: "13px" }}>İstatistikler için en az 2 yakıt kaydı gereklidir.</div>
              </div>
            )}
          </div>
        )}

        {/* ===== YAKIT ===== */}
        {!loading && activeTab === "fuel" && (
          <div>
            {/* Sub tabs */}
            <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
              {[{ id: "records", label: "Kayıtlar" }, { id: "monthly", label: "Aylık" }, { id: "prices", label: "Fiyatlar" }].map(t => (
                <button key={t.id} onClick={() => setFuelSubTab(t.id)} style={{ background: fuelSubTab === t.id ? "#64d2ff" : "transparent", color: fuelSubTab === t.id ? "#000" : "#4a6080", border: "1px solid " + (fuelSubTab === t.id ? "#64d2ff" : "#1a2a45"), padding: "6px 16px", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "20px" }}>{t.label}</button>
              ))}
            </div>

            {/* Records sub-tab */}
            {fuelSubTab === "records" && (() => {
              const months = [...new Set(enriched.map(e => e.date.slice(0, 7)))].sort().reverse();
              const filteredEnriched = filterMonth === "all" ? enriched : enriched.filter(e => e.date.startsWith(filterMonth));
              return (
                <div>


                  {showForm && (
                    <div id="kayit-form" style={{ background: "#0d1524", padding: "20px", border: "1px solid #1a2a45", borderRadius: "12px", marginBottom: "12px" }}>
                      <div style={{ marginBottom: "18px" }}>
                        <div style={{ ...lbl, color: "#64d2ff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>📷 Fiş Fotoğrafı (Opsiyonel)</span>
                          {receiptImage && !geminiLoading && (
                            <button onClick={() => analyzeReceiptWithGemini(receiptFile)} style={{ background: "#6644ff", border: "none", color: "#fff", padding: "3px 10px", fontSize: "10px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "5px" }}>✨ Fişi Oku</button>
                          )}
                          {geminiLoading && <span style={{ fontSize: "10px", color: "#6644ff" }}>⏳ Okunuyor...</span>}
                        </div>
                        {showGeminiKey && !geminiKey && (
                          <div style={{ background: "#0d1524", border: "1px solid #6644ff", borderRadius: "8px", padding: "10px", marginBottom: "8px", marginTop: "6px" }}>
                            <div style={{ fontSize: "11px", color: "#8aa4c8", marginBottom: "6px" }}>Gemini API anahtarı gir (bir kez kaydedilir)</div>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <input type="password" placeholder="AIza..." value={geminiKeyInput} onChange={e => setGeminiKeyInput(e.target.value)} style={{ ...inp, flex: 1, fontSize: "12px" }} />
                              <button onClick={() => { const v = geminiKeyInput.trim(); if (v) { setGeminiKey(v); setShowGeminiKey(false); analyzeReceiptWithGemini(receiptFile); } }} style={{ background: "#6644ff", border: "none", color: "#fff", padding: "0 14px", fontSize: "12px", fontWeight: "700", cursor: "pointer", borderRadius: "8px" }}>Kaydet</button>
                            </div>
                          </div>
                        )}
                        <label style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", background: "#080c14", border: "1px dashed #333", padding: "14px 16px", borderRadius: "8px" }}>
                          <input type="file" accept="image/*" onChange={e => { const f = e.target.files[0]; if (!f) return; setReceiptFile(f); setReceiptImage(URL.createObjectURL(f)); }} style={{ display: "none" }} />
                          {receiptImage ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                              <img src={receiptImage} alt="fiş" style={{ width: "40px", height: "54px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "4px" }} />
                              <div>
                                <div style={{ color: "#44ff88", fontSize: "13px" }}>✓ Fotoğraf eklendi</div>
                                <div style={{ color: "#4a6080", fontSize: "10px", marginTop: "2px" }}>Fişi Oku butonu ile formu otomatik doldur</div>
                              </div>
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
                            ? <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} style={{ ...inp, borderColor: form.date ? "#64d2ff" : "#1a2a45", colorScheme: "dark" }} />
                            : <input type="text" placeholder="GG.AA.YYYY" value={form.date} onChange={e => { const raw = e.target.value; setForm(p => { const parts = raw.split("."); const iso = parts.length === 3 && parts[2].length === 4 ? `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}` : raw; return { ...p, date: iso }; }); }} style={{ ...inp, borderColor: form.date ? "#64d2ff" : "#1a2a45" }} />}
                        </div>
                        <div><label style={lbl}>Güncel Km</label><NumericInput placeholder="45.230" value={form.km} onChange={v => setForm(p => ({ ...p, km: v }))} style={{ ...inp, borderColor: form.km ? "#64d2ff" : "#1a2a45" }} /></div>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                            <label style={lbl}>Ödenen Toplam ₺</label>
                            {shellPrice.benzin && <span style={{ fontSize: "10px", color: "#64d2ff", fontWeight: "600" }}>Benzin 95: {formatNumber(parseTR(shellPrice.benzin))} ₺/L</span>}
                          </div>
                          <NumericInput placeholder="1.250,00" value={form.totalPrice} onChange={v => setForm(p => ({ ...p, totalPrice: v }))} style={{ ...inp, borderColor: form.totalPrice ? "#64d2ff" : "#1a2a45" }} />
                          {form.totalPrice && shellPrice.benzin && (() => { const litre = parseTR(form.totalPrice) / parseTR(shellPrice.benzin); return litre > 0 ? (<div style={{ marginTop: "6px", fontSize: "12px", color: "#64d2ff", fontWeight: "600" }}>≈ {formatNumber(litre)} litre<button onClick={() => setForm(p => ({ ...p, liters: toTR(litre) }))} style={{ marginLeft: "10px", background: "transparent", border: "1px solid #64d2ff", color: "#64d2ff", padding: "2px 8px", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "4px" }}>Kullan</button></div>) : null; })()}
                        </div>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                            <label style={lbl}>Alınan Litre</label>
                            {form.liters && <span style={{ fontSize: "10px", color: "#4a6080" }}>{formatNumber(parseTR(form.liters))} L</span>}
                          </div>
                          <NumericInput placeholder="35,5" value={form.liters} onChange={v => setForm(p => ({ ...p, liters: v }))} style={{ ...inp, borderColor: form.liters ? "#64d2ff" : "#1a2a45" }} />
                        </div>
                      </div>
                      <button onClick={handleAdd} disabled={saving || !form.date || !form.km || !form.liters || !form.totalPrice} style={{ background: (saving || !form.date || !form.km || !form.liters || !form.totalPrice) ? "#1a2a45" : "#64d2ff", color: (saving || !form.date || !form.km || !form.liters || !form.totalPrice) ? "#3d5270" : "#000", border: "none", padding: "12px 28px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "8px" }}>
                        {saving ? "Kaydediliyor..." : "Kaydet →"}
                      </button>
                      {saveError && <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "8px" }}>⚠ {saveError}</div>}
                    </div>
                  )}

                  {/* CSV İndir */}
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: "10px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px" }}>Kayıtlar ({filteredEnriched.length})</div>
                      <button onClick={() => setShowCsvOptions(p => !p)} style={{ background: "transparent", border: "1px solid #1a2a45", color: "#64d2ff", padding: "4px 10px", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>⬇ CSV İndir</button>
                    </div>
                    {showCsvOptions && (
                      <div style={{ background: "#0d1524", border: "1px solid #1a2a45", borderRadius: "8px", padding: "12px", marginTop: "8px" }}>
                        <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
                          <button onClick={() => setCsvMode("range")} style={{ flex: 1, background: csvMode === "range" ? "#64d2ff" : "transparent", color: csvMode === "range" ? "#000" : "#4a6080", border: "1px solid " + (csvMode === "range" ? "#64d2ff" : "#1a2a45"), padding: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>Tarih Aralığı</button>
                          <button onClick={() => setCsvMode("month")} style={{ flex: 1, background: csvMode === "month" ? "#64d2ff" : "transparent", color: csvMode === "month" ? "#000" : "#4a6080", border: "1px solid " + (csvMode === "month" ? "#64d2ff" : "#1a2a45"), padding: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>Aylık</button>
                        </div>
                        {csvMode === "range" ? (
                          <>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "10px" }}>
                              <input type="date" value={csvFrom} onChange={e => setCsvFrom(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                              <span style={{ color: "#4a6080", fontSize: "11px" }}>—</span>
                              <input type="date" value={csvTo} onChange={e => setCsvTo(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                            </div>
                            <button onClick={() => {
                              let rows = enriched;
                              if (csvFrom) rows = rows.filter(e => e.date >= csvFrom);
                              if (csvTo) rows = rows.filter(e => e.date <= csvTo);
                              const label = csvFrom || csvTo ? `${csvFrom||""}--${csvTo||""}` : "tum";
                              downloadCSV(rows, `yakit-${label}.csv`);
                            }} style={{ width: "100%", background: "#64d2ff", border: "none", color: "#000", padding: "9px", fontSize: "11px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>⬇ İndir</button>
                          </>
                        ) : (
                          <>
                            <select value={csvMonth} onChange={e => setCsvMonth(e.target.value)} style={{ ...editInp, width: "100%", marginBottom: "10px", appearance: "none", fontSize: "12px" }}>
                              <option value="">— Ay seç —</option>
                              {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
                            </select>
                            <button onClick={() => {
                              if (!csvMonth) return;
                              const rows = enriched.filter(e => e.date.startsWith(csvMonth));
                              downloadCSV(rows, `yakit-${csvMonth}.csv`);
                            }} disabled={!csvMonth} style={{ width: "100%", background: csvMonth ? "#64d2ff" : "#1a2a45", border: "none", color: csvMonth ? "#000" : "#3d5270", padding: "9px", fontSize: "11px", fontWeight: "700", cursor: csvMonth ? "pointer" : "default", fontFamily: FONT, borderRadius: "6px" }}>⬇ İndir</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {months.length > 1 && (
                    <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
                      <button onClick={() => setFilterMonth("all")} style={{ background: filterMonth === "all" ? "#64d2ff" : "transparent", color: filterMonth === "all" ? "#000" : "#4a6080", border: "1px solid " + (filterMonth === "all" ? "#64d2ff" : "#1a2a45"), padding: "5px 12px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "20px" }}>Tümü</button>
                      {months.map(m => (
                        <button key={m} onClick={() => setFilterMonth(m)} style={{ background: filterMonth === m ? "#64d2ff" : "transparent", color: filterMonth === m ? "#000" : "#4a6080", border: "1px solid " + (filterMonth === m ? "#64d2ff" : "#1a2a45"), padding: "5px 12px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "20px" }}>{monthName(m)}</button>
                      ))}
                    </div>
                  )}

                  {filteredEnriched.length === 0
                    ? <div style={{ color: "#4a6080", textAlign: "center", padding: "48px", fontSize: "14px" }}>Kayıt yok.</div>
                    : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {filteredEnriched.map((e, i) => (
                          <div key={e.id} className="card" style={{ background: "#0f1829", borderRadius: "12px", borderLeft: i === 0 ? "3px solid #1a2a45" : "3px solid #64d2ff", overflow: "hidden" }}>
                            {editingId === e.id ? (
                              <div style={{ padding: "14px" }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                                  <div><div style={{ ...lbl, marginBottom: "4px" }}>Tarih</div><input type="date" value={editForm.date} onChange={ev => setEditForm(p => ({ ...p, date: ev.target.value }))} style={{ ...editInp, colorScheme: "dark" }} /></div>
                                  <div><div style={{ ...lbl, marginBottom: "4px" }}>Km</div><NumericInput value={editForm.km} onChange={v => setEditForm(p => ({ ...p, km: v }))} placeholder="45.230" style={editInp} /></div>
                                  <div><div style={{ ...lbl, marginBottom: "4px" }}>Litre</div><NumericInput value={editForm.liters} onChange={v => setEditForm(p => ({ ...p, liters: v }))} placeholder="35,5" style={editInp} /></div>
                                  <div><div style={{ ...lbl, marginBottom: "4px" }}>Tutar ₺</div><NumericInput value={editForm.totalPrice} onChange={v => setEditForm(p => ({ ...p, totalPrice: v }))} placeholder="1.250,00" style={editInp} /></div>
                                  <div>
                                    <div style={{ ...lbl, marginBottom: "4px" }}>📷 Fiş Fotoğrafı</div>
                                    <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", background: "#080c14", border: "1px dashed #1a2a45", padding: "10px 12px", borderRadius: "8px" }}>
                                      <input type="file" accept="image/*" onChange={ev => { const f = ev.target.files[0]; if (!f) return; setEditReceiptFile(f); setEditReceiptPreview(URL.createObjectURL(f)); }} style={{ display: "none" }} />
                                      {editReceiptPreview ? <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><img src={editReceiptPreview} alt="fiş" style={{ width: "30px", height: "30px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "5px" }} /><span style={{ color: "#44cc88", fontSize: "12px" }}>✓ Fotoğraf seçildi</span></div> : <span style={{ color: "#4a6080", fontSize: "12px" }}>+ Fotoğraf ekle</span>}
                                    </label>
                                  </div>
                                </div>
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <button onClick={handleEditSave} disabled={editSaving} style={{ background: "#64d2ff", color: "#000", border: "none", padding: "8px 20px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>{editSaving ? "Kaydediliyor..." : "Kaydet ✓"}</button>
                                  <button onClick={() => { setEditingId(null); setEditError(null); }} style={{ background: "transparent", color: "#888", border: "1px solid #1a2a45", padding: "8px 16px", fontSize: "12px", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>İptal</button>
                                </div>
                                {editError && <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "8px" }}>⚠ {editError}</div>}
                              </div>
                            ) : (
                              <>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 8px", flexWrap: "wrap", gap: "6px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "15px", fontWeight: "800", color: i === 0 ? "#4a6080" : "#e8eef8", fontFamily: MONO, letterSpacing: "-0.3px" }}>{fmtDate(e.date)}</span>
                                    {e.consumption && i > 0 && (() => { const prev = enriched[i - 1]; if (!prev?.consumption) return null; const diff = e.consumption - prev.consumption; if (Math.abs(diff) < 0.1) return null; return <span style={{ fontSize: "11px", fontWeight: "700", color: diff < 0 ? "#44cc88" : "#ff6655" }}>{diff < 0 ? "↓" : "↑"} {formatNumber(Math.abs(diff))} L/100km</span>; })()}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    {e.receipt && <a href={e.receipt} target="_blank" rel="noopener noreferrer"><img src={e.receipt} alt="fiş" style={{ width: "30px", height: "30px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "5px", display: "block" }} /></a>}
                                    <button onClick={() => startEdit(e)} style={{ background: "none", border: "1px solid #1a2a45", color: "#666", cursor: "pointer", padding: "5px 9px", fontSize: "11px", fontFamily: FONT, borderRadius: "5px" }} onMouseEnter={ev => { ev.target.style.borderColor = "#64d2ff"; ev.target.style.color = "#64d2ff"; }} onMouseLeave={ev => { ev.target.style.borderColor = "#1a2a45"; ev.target.style.color = "#666"; }}>✎</button>
                                    <button onClick={() => handleDelete(e.id, e.receipt)} style={{ background: "none", border: "1px solid #1a2a45", color: "#3d5270", cursor: "pointer", padding: "5px 9px", fontSize: "12px", fontFamily: FONT, borderRadius: "5px" }} onMouseEnter={ev => { ev.target.style.borderColor = "#ff4444"; ev.target.style.color = "#ff4444"; }} onMouseLeave={ev => { ev.target.style.borderColor = "#1a2a45"; ev.target.style.color = "#3d5270"; }}>✕</button>
                                  </div>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "18% 18% 16% 26% 22%", borderTop: "1px solid #1a2a45" }}>
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
                </div>
              );
            })()}

            {/* Monthly sub-tab */}
            {fuelSubTab === "monthly" && (() => {
              const byMonth = {};
              enriched.forEach(e => {
                const key = e.date.slice(0, 7);
                if (!byMonth[key]) byMonth[key] = { liters: 0, spent: 0, km: 0, count: 0, entries: [] };
                byMonth[key].liters += e.liters; byMonth[key].spent += e.totalPrice; byMonth[key].count += 1; byMonth[key].entries.push(e);
              });
              const months = Object.keys(byMonth).sort().reverse();
              return (
                <div>
                  {months.length === 0
                    ? <div style={{ color: "#4a6080", textAlign: "center", padding: "48px" }}>Kayıt yok.</div>
                    : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {months.map(key => {
                          const m = byMonth[key];
                          const sortedE = [...m.entries].sort((a, b) => a.date.localeCompare(b.date));
                          const monthKm = sortedE.length >= 2 ? sortedE[sortedE.length - 1].km - sortedE[0].km : null;
                          const cons = monthKm > 0 ? (m.liters / monthKm) * 100 : null;
                          return (
                            <div key={key} className="card" style={{ background: "#0f1829", borderRadius: "12px", borderLeft: "3px solid #64d2ff", overflow: "hidden" }}>
                              <div style={{ padding: "12px 14px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: "15px", fontWeight: "800", color: "#e8eef8", fontFamily: MONO }}>{monthName(key)}</span>
                                <span style={{ fontSize: "11px", color: "#4a6080", fontWeight: "500" }}>{m.count} dolum</span>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "18% 18% 16% 26% 22%", borderTop: "1px solid #1a2a45" }}>
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

            {/* Prices sub-tab */}
            {fuelSubTab === "prices" && (
              <div>
                <div style={{ background: "#0f1829", border: "1px solid #1a2a45", borderRadius: "10px", padding: "16px", marginBottom: "16px", borderLeft: "3px solid #64d2ff" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: "#64d2ff", textTransform: "uppercase", letterSpacing: "1px" }}>📡 EPDK Güncel Fiyatlar</div>
                    <button onClick={() => fetchEpdk(true)} disabled={epdkLoading} style={{ background: "transparent", border: "1px solid #1a2a45", color: "#666", padding: "5px 12px", fontSize: "11px", fontWeight: "600", cursor: epdkLoading ? "not-allowed" : "pointer", fontFamily: FONT, borderRadius: "20px", opacity: epdkLoading ? 0.4 : 1 }}>↻ Güncelle</button>
                  </div>
                  <div style={{ textAlign: "center", fontSize: "12px", color: "#4a6080", marginBottom: "10px" }}>
                    {epdkLoading ? <span style={{ color: "#64d2ff", animation: "pulse 1s infinite" }}>⏳ Fiyatlar alınıyor...</span> : <>📍 {(userIl || "").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}{userIlce ? ` / ${userIlce.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}` : ""}</>}
                  </div>
                  {epdkError && <div style={{ fontSize: "12px", color: "#ff4444", marginBottom: "8px" }}>⚠ {epdkError}</div>}
                  {epdkData ? (
                    <div>
                      <div style={{ fontSize: "10px", color: "#3d5270", marginBottom: "10px" }}>Tarih: {epdkData.tarih}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                        {epdkData.benzin95 && <div style={{ background: "#080c14", padding: "12px", borderRadius: "8px" }}><div style={{ fontSize: "10px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>🟢 Benzin 95</div><div style={{ fontSize: "18px", fontWeight: "800", color: "#e8eef8", fontFamily: MONO }}>{formatNumber(epdkData.benzin95.fiyat)} ₺</div></div>}
                        {epdkData.motorin && <div style={{ background: "#080c14", padding: "12px", borderRadius: "8px" }}><div style={{ fontSize: "10px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>⚫ Motorin</div><div style={{ fontSize: "18px", fontWeight: "800", color: "#e8eef8", fontFamily: MONO }}>{formatNumber(epdkData.motorin.fiyat)} ₺</div></div>}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "10px" }}>
                        {epdkData.benzin95 && <button onClick={() => setShellPrice(p => ({ ...p, benzin: toTR(epdkData.benzin95.fiyat) }))} style={{ background: "transparent", border: "1px solid #1a2a45", color: "#4a6080", padding: "7px 8px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>↓ Benzin fiyatını forma aktar</button>}
                        {epdkData.motorin && <button onClick={() => setShellPrice(p => ({ ...p, motorin: toTR(epdkData.motorin.fiyat) }))} style={{ background: "transparent", border: "1px solid #1a2a45", color: "#4a6080", padding: "7px 8px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>↓ Motorin fiyatını forma aktar</button>}
                        {(epdkData.benzin95 || epdkData.motorin) && <button onClick={() => setShellPrice({ benzin: epdkData.benzin95 ? toTR(epdkData.benzin95.fiyat) : "", motorin: epdkData.motorin ? toTR(epdkData.motorin.fiyat) : "" })} style={{ background: "#64d2ff", border: "none", color: "#000", padding: "8px 14px", fontSize: "11px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px", gridColumn: "1 / -1" }}>↓ Tümünü forma aktar</button>}
                      </div>
                    </div>
                  ) : <div style={{ fontSize: "13px", color: "#4a6080", textAlign: "center", padding: "12px 0" }}>EPDK'dan güncel fiyatı çekmek için "↻ Güncelle" butonuna bas.</div>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {[{ key: "benzin", label: "Benzin (95)", emoji: "🟢" }, { key: "motorin", label: "Motorin", emoji: "⚫" }].map(f => (
                    <div key={f.key} style={{ background: "#0f1829", padding: "12px 10px", borderRadius: "10px", textAlign: "center" }}>
                      <div style={{ fontSize: "11px", fontWeight: "600", color: "#4a6080", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{f.emoji} {f.label}</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                        <NumericInput placeholder="0,00" value={shellPrice[f.key]} onChange={v => setShellPrice(p => ({ ...p, [f.key]: v }))} style={{ background: "#080c14", border: "1px solid #1a2a45", color: "#e8eef8", padding: "8px 6px", fontSize: "14px", fontWeight: "800", width: "100%", fontFamily: MONO, outline: "none", borderRadius: "6px", textAlign: "center" }} />
                        <span style={{ color: "#4a6080", fontWeight: "600", flexShrink: 0 }}>₺</span>
                      </div>
                      {shellPrice[f.key] && <div style={{ marginTop: "8px", fontSize: "12px", color: "#64d2ff", fontWeight: "600" }}>✓ {formatNumber(parseTR(shellPrice[f.key]))} ₺/L</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== BAKIM ===== */}
        {!loading && activeTab === "maintenance" && (
          <div>
            {/* Summary */}
            <div style={{ marginBottom: "12px" }}>
              <div className="card" style={{ background: "#0f1829", borderRadius: "12px", padding: "14px 12px", borderTop: "2px solid #ffdd00" }}>
                <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Top. Bakım Maliyeti</div>
                <div style={{ fontSize: "16px", fontWeight: "800", color: "#ffdd00", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{formatNumber(totalMaintCost)} ₺</div>
              </div>

            </div>



            {showMaintForm && (
              <div id="maint-form" style={{ background: "#0d1524", padding: "20px", border: "1px solid #1a2a45", borderRadius: "12px", marginBottom: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
                  <div><div style={lbl}>Tarih</div><input type="date" value={maintForm.date} onChange={e => setMaintForm(p => ({ ...p, date: e.target.value }))} style={{ ...inp, colorScheme: "dark" }} /></div>
                  <div><div style={lbl}>Güncel Km</div><NumericInput value={maintForm.km} onChange={v => setMaintForm(p => ({ ...p, km: v }))} placeholder="15.000" style={inp} /></div>
                  <div>
                    <div style={lbl}>Kategori</div>
                    <select value={maintForm.category} onChange={e => setMaintForm(p => ({ ...p, category: e.target.value }))}>
                      {MAINT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                    </select>
                  </div>
                  <div><div style={lbl}>Açıklama (opsiyonel)</div><input type="text" value={maintForm.description} onChange={e => setMaintForm(p => ({ ...p, description: e.target.value }))} placeholder="Örn: 4 lastik Bridgestone" style={inp} /></div>
                  <div><div style={lbl}>Ücret ₺</div><NumericInput value={maintForm.cost} onChange={v => setMaintForm(p => ({ ...p, cost: v }))} placeholder="1.500,00" style={inp} /></div>
                  <div>
                    <div style={{ ...lbl, color: "#64d2ff" }}>📷 Fotoğraf (opsiyonel)</div>
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", background: "#080c14", border: "1px dashed #333", padding: "12px 14px", borderRadius: "8px", marginBottom: maintReceiptPreviews.length > 0 ? "8px" : 0 }}>
                      <input type="file" accept="image/*" multiple onChange={e => { const newFiles = Array.from(e.target.files); setMaintReceiptFiles(f => [...f, ...newFiles]); setMaintReceiptPreviews(p => [...p, ...newFiles.map(f => URL.createObjectURL(f))]); }} style={{ display: "none" }} />
                      <span style={{ color: "#4a6080", fontSize: "13px" }}>+ Fotoğraf ekle</span>
                    </label>
                    {maintReceiptPreviews.length > 0 && <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>{maintReceiptPreviews.map((src, i) => (<div key={i} style={{ position: "relative" }}><img src={src} alt="" style={{ width: "48px", height: "48px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "6px" }} /><button onClick={() => { setMaintReceiptFiles(f => f.filter((_,fi) => fi !== i)); setMaintReceiptPreviews(p => p.filter((_,pi) => pi !== i)); }} style={{ position: "absolute", top: "-6px", right: "-6px", background: "#ff4444", border: "none", borderRadius: "50%", width: "16px", height: "16px", color: "#fff", fontSize: "9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: 0, padding: 0 }}>✕</button></div>))}</div>}
                  </div>
                </div>
                <button onClick={handleAddMaint} disabled={maintSaving || !maintForm.date || !maintForm.km || !maintForm.cost} style={{ background: (!maintForm.date || !maintForm.km || !maintForm.cost) ? "#1a2a45" : "#64d2ff", color: (!maintForm.date || !maintForm.km || !maintForm.cost) ? "#3d5270" : "#000", border: "none", padding: "12px 28px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "8px" }}>
                  {maintSaving ? "Kaydediliyor..." : "Kaydet →"}
                </button>
              </div>
            )}

            {maintLoading
              ? <div style={{ textAlign: "center", padding: "32px", color: "#4a6080" }}>Yükleniyor...</div>
              : maintEntries.length === 0
                ? <div style={{ color: "#4a6080", textAlign: "center", padding: "48px", fontSize: "14px" }}>Henüz bakım kaydı yok.</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {maintEntries.map(e => {
                      const cat = MAINT_CATEGORIES.find(c => c.id === e.category) || MAINT_CATEGORIES[0];
                      return (
                        <div key={e.id} className="card" style={{ background: "#0f1829", borderRadius: "12px", borderLeft: `3px solid ${cat.color}`, overflow: "hidden" }}>
                          {editingMaintId === e.id ? (
                            <div style={{ padding: "14px" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Tarih</div><input type="date" value={editMaintForm.date} onChange={ev => setEditMaintForm(p => ({ ...p, date: ev.target.value }))} style={{ ...editInp, colorScheme: "dark" }} /></div>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Km</div><NumericInput value={editMaintForm.km} onChange={v => setEditMaintForm(p => ({ ...p, km: v }))} placeholder="15.000" style={editInp} /></div>
                                <div>
                                  <div style={{ ...lbl, marginBottom: "4px" }}>Kategori</div>
                                  <select value={editMaintForm.category} onChange={ev => setEditMaintForm(p => ({ ...p, category: ev.target.value }))} style={{ ...editInp, appearance: "none" }}>
                                    {MAINT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                                  </select>
                                </div>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Açıklama</div><input type="text" value={editMaintForm.description} onChange={ev => setEditMaintForm(p => ({ ...p, description: ev.target.value }))} style={editInp} /></div>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Ücret ₺</div><NumericInput value={editMaintForm.cost} onChange={v => setEditMaintForm(p => ({ ...p, cost: v }))} placeholder="1.500,00" style={editInp} /></div>
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button onClick={handleEditMaintSave} disabled={editMaintSaving} style={{ background: "#64d2ff", color: "#000", border: "none", padding: "8px 20px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>{editMaintSaving ? "Kaydediliyor..." : "Kaydet ✓"}</button>
                                <button onClick={() => setEditingMaintId(null)} style={{ background: "transparent", color: "#888", border: "1px solid #1a2a45", padding: "8px 16px", fontSize: "12px", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>İptal</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 8px", flexWrap: "wrap", gap: "6px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ fontSize: "13px", fontWeight: "800", color: cat.color }}>{cat.emoji} {cat.label}</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  {(e.receipts && e.receipts.length > 0 ? e.receipts : e.receipt ? [e.receipt] : []).map((url, i) => (<a key={i} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="foto" style={{ width: "30px", height: "30px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "5px", display: "block" }} /></a>))}
                                  <button onClick={() => startEditMaint(e)} style={{ background: "none", border: "1px solid #1a2a45", color: "#666", cursor: "pointer", padding: "5px 9px", fontSize: "11px", fontFamily: FONT, borderRadius: "5px" }} onMouseEnter={ev => { ev.target.style.borderColor = "#64d2ff"; ev.target.style.color = "#64d2ff"; }} onMouseLeave={ev => { ev.target.style.borderColor = "#1a2a45"; ev.target.style.color = "#666"; }}>✎</button>
                                  <button onClick={() => handleDeleteMaint(e.id)} style={{ background: "none", border: "1px solid #1a2a45", color: "#3d5270", cursor: "pointer", padding: "5px 9px", fontSize: "12px", fontFamily: FONT, borderRadius: "5px" }} onMouseEnter={ev => { ev.target.style.borderColor = "#ff4444"; ev.target.style.color = "#ff4444"; }} onMouseLeave={ev => { ev.target.style.borderColor = "#1a2a45"; ev.target.style.color = "#3d5270"; }}>✕</button>
                                </div>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", borderTop: "1px solid #1a2a45" }}>
                                {[
                                  { label: "Tarih", val: fmtDate(e.date) },
                                  { label: "Km", val: formatNumber(e.km, 0) },
                                  { label: "Ücret", val: `${formatNumber(e.cost)} ₺`, highlight: true },
                                ].map((col, ci) => (
                                  <div key={col.label} style={{ padding: "8px 4px", borderRight: ci < 2 ? "1px solid #1a2a45" : "none" }}>
                                    <div style={{ fontSize: "8px", fontWeight: "600", color: "#3d5270", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>{col.label}</div>
                                    <div style={{ fontSize: "12px", fontWeight: "700", color: col.highlight ? cat.color : "#8aa4c8", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{col.val}</div>
                                  </div>
                                ))}
                              </div>
                              {e.description && <div style={{ padding: "8px 14px", fontSize: "12px", color: "#4a6080", borderTop: "1px solid #1a2a45" }}>{e.description}</div>}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
            }
          </div>
        )}

        {/* ===== YOLCULUK ===== */}
        {!loading && activeTab === "trips" && (
          <div>
            {/* Summary */}
            {tripEntries.length > 0 && (() => {
              const totalTripKm = tripEntries.reduce((s, t) => s + (t.endKm - t.startKm), 0);
              const totalTripCost = tripEntries.reduce((s, t) => s + calcTrip(t).total, 0);
              const totalTollCost = tripEntries.reduce((s, t) => s + t.tollCost, 0);
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px", marginBottom: "12px" }}>
                  {[
                    { label: "Toplam Km", val: formatNumber(totalTripKm, 0), color: "#cc88ff" },
                    { label: "Otoyol", val: `${formatNumber(totalTollCost)} ₺`, color: "#ffdd00" },
                    { label: "Top. Harcama", val: `${formatNumber(totalTripCost)} ₺`, color: "#ff6655" },
                  ].map(s => (
                    <div key={s.label} className="card" style={{ background: "#0f1829", borderRadius: "12px", padding: "14px 12px", borderTop: `2px solid ${s.color}` }}>
                      <div style={{ fontSize: "9px", fontWeight: "600", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>{s.label}</div>
                      <div style={{ fontSize: "13px", fontWeight: "800", color: s.color, fontFamily: MONO, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{s.val}</div>
                    </div>
                  ))}
                </div>
              );
            })()}



            {showTripForm && (
              <div id="trip-form" style={{ background: "#0d1524", padding: "20px", border: "1px solid #1a2a45", borderRadius: "12px", marginBottom: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
                  <div><div style={lbl}>Yolculuk Adı (opsiyonel)</div><input type="text" value={tripForm.title} onChange={e => setTripForm(p => ({ ...p, title: e.target.value }))} placeholder="Bursa → İstanbul" style={inp} /></div>
                  <div><div style={lbl}>Tarih</div><input type="date" value={tripForm.date} onChange={e => setTripForm(p => ({ ...p, date: e.target.value }))} style={{ ...inp, colorScheme: "dark" }} /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div><div style={lbl}>Başlangıç Km</div><NumericInput value={tripForm.startKm} onChange={v => setTripForm(p => ({ ...p, startKm: v }))} placeholder="15.000" style={inp} /></div>
                    <div><div style={lbl}>Bitiş Km</div><NumericInput value={tripForm.endKm} onChange={v => setTripForm(p => ({ ...p, endKm: v }))} placeholder="15.280" style={inp} /></div>
                  </div>
                  {tripForm.startKm && tripForm.endKm && parseTR(tripForm.endKm) > parseTR(tripForm.startKm) && (
                    <div style={{ background: "#080c14", border: "1px solid #1a2a45", borderRadius: "8px", padding: "10px 12px", fontSize: "12px", color: "#64d2ff", fontWeight: "600" }}>
                      📍 {formatNumber(parseTR(tripForm.endKm) - parseTR(tripForm.startKm), 0)} km
                    </div>
                  )}
                  <div>
                    <div style={{ ...lbl, marginBottom: "6px" }}>Yakıt Tüketimi (L/100 km)</div>
                    <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                      <button onClick={() => setTripForm(p => ({ ...p, consumptionMode: "manual" }))} style={{ flex: 1, background: tripForm.consumptionMode === "manual" ? "#64d2ff" : "transparent", color: tripForm.consumptionMode === "manual" ? "#000" : "#4a6080", border: "1px solid " + (tripForm.consumptionMode === "manual" ? "#64d2ff" : "#1a2a45"), padding: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>Manuel Giriş</button>
                      <button onClick={() => setTripForm(p => ({ ...p, consumptionMode: "auto" }))} style={{ flex: 1, background: tripForm.consumptionMode === "auto" ? "#64d2ff" : "transparent", color: tripForm.consumptionMode === "auto" ? "#000" : "#4a6080", border: "1px solid " + (tripForm.consumptionMode === "auto" ? "#64d2ff" : "#1a2a45"), padding: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>Dolumlardan Hesapla</button>
                    </div>
                    {tripForm.consumptionMode === "manual" ? (
                      <NumericInput value={tripForm.consumption} onChange={v => setTripForm(p => ({ ...p, consumption: v }))} placeholder="6,5" style={inp} />
                    ) : (() => {
                      const startKm = parseTR(tripForm.startKm);
                      const endKm = parseTR(tripForm.endKm);
                      if (!startKm || !endKm || endKm <= startKm) return <div style={{ fontSize: "12px", color: "#4a6080", padding: "10px 0" }}>Önce başlangıç ve bitiş km gir.</div>;
                      const km = endKm - startKm;
                      const fuelsInRange = entries.filter(e => e.km > startKm && e.km <= endKm && e.liters > 0).sort((a,b) => a.km - b.km);
                      const tankLiters = 40;
                      const tankPct = parseTR(tripForm.tankPercent) || 100;
                      const startFuel = tankLiters * (tankPct / 100);
                      const refueled = fuelsInRange.reduce((s, e) => s + e.liters, 0);
                      const totalUsed = startFuel + refueled; // bitişteki kalan yakıt bilinmiyor = 0 varsayımı
                      const calcL100 = km > 0 ? (totalUsed / km) * 100 : 0;
                      if (fuelsInRange.length === 0 && tankPct === 100) return (
                        <div style={{ fontSize: "12px", color: "#4a6080", padding: "6px 0" }}>Bu km aralığında dolum kaydı yok.</div>
                      );
                      return (
                        <div>
                          <div style={{ background: "#080c14", borderRadius: "8px", padding: "10px 12px", marginBottom: "8px" }}>
                            <div style={{ fontSize: "10px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Yolculuk Başındaki Depo Durumu</div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <NumericInput value={tripForm.tankPercent} onChange={v => setTripForm(p => ({ ...p, tankPercent: v }))} placeholder="100" style={{ ...inp, width: "70px", flex: "none" }} />
                              <span style={{ fontSize: "12px", color: "#8aa4c8" }}>%  = {formatNumber(startFuel)} L</span>
                            </div>
                          </div>
                          {fuelsInRange.length > 0 && (
                            <div style={{ background: "#080c14", borderRadius: "8px", padding: "10px 12px", marginBottom: "8px" }}>
                              <div style={{ fontSize: "10px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Bu Km Aralığındaki Dolumlar</div>
                              {fuelsInRange.map((e,i) => (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#8aa4c8", padding: "2px 0" }}>
                                  <span>{fmtDate(e.date)} — {formatNumber(e.km,0)} km</span>
                                  <span style={{ color: "#64d2ff", fontFamily: MONO }}>{formatNumber(e.liters)} L</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ background: "#080c14", border: "1px solid #64d2ff", borderRadius: "8px", padding: "10px 12px", marginBottom: "8px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <div style={{ fontSize: "10px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px" }}>Hesaplanan L/100km</div>
                                <div style={{ fontSize: "11px", color: "#4a6080", marginTop: "2px" }}>{formatNumber(startFuel)} L başlangıç + {formatNumber(refueled)} L dolum = {formatNumber(totalUsed)} L / {formatNumber(km,0)} km</div>
                              </div>
                              <span style={{ fontSize: "20px", fontWeight: "800", color: "#64d2ff", fontFamily: MONO }}>{formatNumber(calcL100)}</span>
                            </div>
                          </div>
                          <button onClick={() => setTripForm(p => ({ ...p, consumption: toTR(calcL100) }))} style={{ width: "100%", background: "#1a2a45", border: "1px solid #64d2ff", color: "#64d2ff", padding: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>Kullan → {formatNumber(calcL100)} L/100km</button>
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <div style={lbl}>Yolculuk Tarihi Aralığı (litre fiyatı için)</div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                      <input type="date" value={tripForm.tripDateFrom} onChange={e => setTripForm(p => ({ ...p, tripDateFrom: e.target.value }))} style={{ ...inp, colorScheme: "dark" }} />
                      <input type="date" value={tripForm.tripDateTo} onChange={e => setTripForm(p => ({ ...p, tripDateTo: e.target.value }))} style={{ ...inp, colorScheme: "dark" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <div style={lbl}>Litre Fiyatı ₺</div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        {(tripForm.tripDateFrom || tripForm.tripDateTo) && (() => {
                          const from = tripForm.tripDateFrom || "0000-00-00";
                          const to = tripForm.tripDateTo || "9999-99-99";
                          const relevant = entries.filter(e => e.date >= from && e.date <= to && e.liters > 0);
                          if (relevant.length === 0) return null;
                          const avgPrice = relevant.reduce((s, e) => s + e.totalPrice / e.liters, 0) / relevant.length;
                          return <button onClick={() => setTripForm(p => ({ ...p, fuelPrice: toTR(avgPrice) }))} style={{ background: "none", border: "1px solid #44cc88", color: "#44cc88", padding: "3px 8px", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "4px" }}>⌀ Ort. al ({relevant.length} dolum)</button>;
                        })()}
                        {shellPrice.benzin && <button onClick={() => setTripForm(p => ({ ...p, fuelPrice: shellPrice.benzin }))} style={{ background: "none", border: "1px solid #1a2a45", color: "#64d2ff", padding: "3px 8px", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "4px" }}>EPDK'dan al</button>}
                      </div>
                    </div>
                    <NumericInput value={tripForm.fuelPrice} onChange={v => setTripForm(p => ({ ...p, fuelPrice: v }))} placeholder="44,50" style={inp} />
                    {tripForm.fuelPrice && <div style={{ marginTop: "4px", fontSize: "11px", color: "#4a6080" }}>Manuel düzenleme yapabilirsin</div>}
                  </div>
                  <div>
                    <div style={lbl}>Otoyol / Köprü Geçişleri</div>
                    <button onClick={() => { setShowTollAdder(p => !p); setTollAddValue(""); setTollAddLabel(""); }} style={{ width: "100%", height: "44px", background: showTollAdder ? "#64d2ff" : "#1a2a45", border: "1px solid #2a3a55", color: showTollAdder ? "#000" : "#64d2ff", borderRadius: "6px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, marginBottom: "8px" }}>{showTollAdder ? "✕ İptal" : "+ Geçiş Ekle"}</button>
                    {showTollAdder && (
                      <div style={{ display: "flex", gap: "6px", marginBottom: "8px", alignItems: "center" }}>
                        <input type="text" value={tollAddLabel} onChange={e => setTollAddLabel(e.target.value)} placeholder="Geçiş adı (opsiyonel)" style={{ ...inp, flex: 1.5, fontSize: "12px" }} />
                        <NumericInput value={tollAddValue} onChange={v => setTollAddValue(v)} placeholder="0,00 ₺" style={{ ...inp, flex: 1, fontSize: "12px" }} />
                        <button onClick={() => { const add = parseTR(tollAddValue); if (add > 0) { setTripForm(p => ({ ...p, tollItems: [...(p.tollItems||[]), { label: tollAddLabel || `Geçiş ${(p.tollItems||[]).length+1}`, amount: add }] })); setShowTollAdder(false); setTollAddValue(""); setTollAddLabel(""); } }} style={{ background: "#44cc88", border: "1px solid #2a3a55", color: "#000", borderRadius: "8px", width: "46px", height: "46px", fontSize: "18px", fontWeight: "700", cursor: "pointer", flexShrink: 0, padding: 0 }}>✓</button>
                      </div>
                    )}
                    {(tripForm.tollItems||[]).length > 0 && (
                      <div style={{ marginTop: "4px" }}>
                        <div style={{ marginBottom: "6px" }}>
                          <div style={lbl}>Toplam Otoyol Harcaması</div>
                          <div style={{ ...inp, cursor: "default" }}>{formatNumber((tripForm.tollItems||[]).reduce((s,i) => s+i.amount,0))} ₺</div>
                        </div>
                        {tripForm.tollItems.map((item, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", background: "#080c14", borderRadius: "6px", marginBottom: "4px" }}>
                            <span style={{ fontSize: "12px", color: "#8aa4c8" }}>{item.label}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <span style={{ fontSize: "13px", fontWeight: "700", color: "#ffdd00", fontFamily: MONO }}>{formatNumber(item.amount)} ₺</span>
                              <button onClick={() => setTripForm(p => ({ ...p, tollItems: p.tollItems.filter((_,fi) => fi !== i) }))} style={{ background: "none", border: "none", color: "#ff4444", cursor: "pointer", fontSize: "14px", padding: "0 2px", lineHeight: 1 }}>✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div><div style={lbl}>Not (opsiyonel)</div><input type="text" value={tripForm.notes} onChange={e => setTripForm(p => ({ ...p, notes: e.target.value }))} placeholder="Tatil, iş, vb." style={inp} /></div>
                  <div>
                    <div style={{ ...lbl, color: "#64d2ff" }}>📷 Fotoğraf (opsiyonel)</div>
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", background: "#080c14", border: "1px dashed #333", padding: "12px 14px", borderRadius: "8px", marginBottom: tripReceiptPreviews.length > 0 ? "8px" : 0 }}>
                      <input type="file" accept="image/*" multiple onChange={e => { const newFiles = Array.from(e.target.files); setTripReceiptFiles(f => [...f, ...newFiles]); setTripReceiptPreviews(p => [...p, ...newFiles.map(f => URL.createObjectURL(f))]); }} style={{ display: "none" }} />
                      <span style={{ color: "#4a6080", fontSize: "13px" }}>+ Fotoğraf ekle</span>
                    </label>
                    {tripReceiptPreviews.length > 0 && <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>{tripReceiptPreviews.map((src, i) => (<div key={i} style={{ position: "relative" }}><img src={src} alt="" style={{ width: "48px", height: "48px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "6px" }} /><button onClick={() => { setTripReceiptFiles(f => f.filter((_,fi) => fi !== i)); setTripReceiptPreviews(p => p.filter((_,pi) => pi !== i)); }} style={{ position: "absolute", top: "-6px", right: "-6px", background: "#ff4444", border: "none", borderRadius: "50%", width: "16px", height: "16px", color: "#fff", fontSize: "9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>✕</button></div>))}</div>}
                  </div>
                </div>

                {/* Live calculation preview */}
                {tripForm.startKm && tripForm.endKm && tripForm.consumption && tripForm.fuelPrice && (() => {
                  const km = parseTR(tripForm.endKm) - parseTR(tripForm.startKm);
                  if (km <= 0) return null;
                  const liters = (km * parseTR(tripForm.consumption)) / 100;
                  const fuelCost = liters * parseTR(tripForm.fuelPrice);
                  const toll = parseTR(tripForm.tollCost) || 0;
                  return (
                    <div style={{ background: "#080c14", border: "1px solid #64d2ff", borderRadius: "10px", padding: "14px", marginBottom: "12px" }}>
                      <div style={{ fontSize: "10px", fontWeight: "700", color: "#64d2ff", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" }}>Yolculuk Hesabı</div>
                      {(() => {
                        const wac = calcTripFuelCost(weightedHistory, parseTR(tripForm.startKm), parseTR(tripForm.endKm), parseTR(tripForm.consumption));
                        const wacCost = wac ? wac.cost : fuelCost;
                        const wacAvg = wac ? wac.avgPrice : parseTR(tripForm.fuelPrice);
                        return wac && wac.segments.length > 1 ? (
                          <div style={{ marginBottom: "10px", padding: "8px", background: "#0d1524", borderRadius: "6px" }}>
                            <div style={{ fontSize: "9px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>WAC Segment Analizi</div>
                            {wac.segments.map((s, i) => (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#8aa4c8", padding: "2px 0" }}>
                                <span>{formatNumber(s.km, 0)} km × {formatNumber(s.price)} ₺/L</span>
                                <span style={{ color: "#ffdd00", fontFamily: MONO }}>{formatNumber(s.cost)} ₺</span>
                              </div>
                            ))}
                            <div style={{ borderTop: "1px solid #1a2a45", marginTop: "4px", paddingTop: "4px", display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                              <span style={{ color: "#64d2ff" }}>Ort. WAC</span>
                              <span style={{ color: "#64d2ff", fontFamily: MONO, fontWeight: "700" }}>{formatNumber(wacAvg)} ₺/L</span>
                            </div>
                          </div>
                        ) : null;
                      })()}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "8px" }}>
                        {(() => {
                          const wac = calcTripFuelCost(weightedHistory, parseTR(tripForm.startKm), parseTR(tripForm.endKm), parseTR(tripForm.consumption));
                          const wacCost = wac ? wac.cost : fuelCost;
                          return [
                            { label: "Mesafe", val: `${formatNumber(km, 0)} km` },
                            { label: "Yakıt", val: `${formatNumber(liters)} L` },
                            { label: wac ? "Yakıt (WAC)" : "Yakıt Tutarı", val: `${formatNumber(wacCost)} ₺`, highlight: !!wac },
                            { label: "Toplam", val: `${formatNumber(wacCost + toll)} ₺`, accent: true },
                          ];
                        })().map(r => (
                          <div key={r.label}>
                            <div style={{ fontSize: "9px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "2px" }}>{r.label}</div>
                            <div style={{ fontSize: "14px", fontWeight: "800", color: r.accent ? "#ff6655" : "#e8eef8", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{r.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <button onClick={handleAddTrip} disabled={tripSaving || !tripForm.date || !tripForm.startKm || !tripForm.endKm || !tripForm.consumption} style={{ background: (!tripForm.date || !tripForm.startKm || !tripForm.endKm || !tripForm.consumption) ? "#1a2a45" : "#64d2ff", color: (!tripForm.date || !tripForm.startKm || !tripForm.endKm || !tripForm.consumption || !tripForm.fuelPrice) ? "#3d5270" : "#000", border: "none", padding: "12px 28px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "8px" }}>
                  {tripSaving ? "Kaydediliyor..." : "Kaydet →"}
                </button>
              </div>
            )}

            {tripLoading
              ? <div style={{ textAlign: "center", padding: "32px", color: "#4a6080" }}>Yükleniyor...</div>
              : tripEntries.length === 0
                ? <div style={{ color: "#4a6080", textAlign: "center", padding: "48px", fontSize: "14px" }}>Henüz yolculuk kaydı yok.</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {tripEntries.map(t => {
                      const calc = calcTrip(t);
                      return (
                        <div key={t.id} className="card" style={{ background: "#0f1829", borderRadius: "12px", borderLeft: "3px solid #cc88ff", overflow: "hidden" }}>
                          {editingTripId === t.id ? (
                            <div style={{ padding: "14px" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Yolculuk Adı</div><input type="text" value={editTripForm.title} onChange={ev => setEditTripForm(p => ({ ...p, title: ev.target.value }))} style={editInp} /></div>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Tarih</div><input type="date" value={editTripForm.date} onChange={ev => setEditTripForm(p => ({ ...p, date: ev.target.value }))} style={{ ...editInp, colorScheme: "dark" }} /></div>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Başlangıç Km</div><NumericInput value={editTripForm.startKm} onChange={v => setEditTripForm(p => ({ ...p, startKm: v }))} style={editInp} /></div>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Bitiş Km</div><NumericInput value={editTripForm.endKm} onChange={v => setEditTripForm(p => ({ ...p, endKm: v }))} style={editInp} /></div>
                                <div>
                                  <div style={{ ...lbl, marginBottom: "6px" }}>L/100 km</div>
                                  <div style={{ display: "flex", gap: "5px", marginBottom: "6px" }}>
                                    <button onClick={() => setEditTripForm(p => ({ ...p, consumptionMode: "manual" }))} style={{ flex: 1, background: editTripForm.consumptionMode === "manual" ? "#64d2ff" : "transparent", color: editTripForm.consumptionMode === "manual" ? "#000" : "#4a6080", border: "1px solid " + (editTripForm.consumptionMode === "manual" ? "#64d2ff" : "#1a2a45"), padding: "5px", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "5px" }}>Manuel</button>
                                    <button onClick={() => setEditTripForm(p => ({ ...p, consumptionMode: "auto" }))} style={{ flex: 1, background: editTripForm.consumptionMode === "auto" ? "#64d2ff" : "transparent", color: editTripForm.consumptionMode === "auto" ? "#000" : "#4a6080", border: "1px solid " + (editTripForm.consumptionMode === "auto" ? "#64d2ff" : "#1a2a45"), padding: "5px", fontSize: "10px", fontWeight: "600", cursor: "pointer", fontFamily: FONT, borderRadius: "5px" }}>Dolumlardan</button>
                                  </div>
                                  {editTripForm.consumptionMode === "manual" ? (
                                    <NumericInput value={editTripForm.consumption} onChange={v => setEditTripForm(p => ({ ...p, consumption: v }))} style={editInp} />
                                  ) : (() => {
                                    const startKm = parseTR(editTripForm.startKm);
                                    const endKm = parseTR(editTripForm.endKm);
                                    if (!startKm || !endKm || endKm <= startKm) return <div style={{ fontSize: "11px", color: "#4a6080" }}>Km aralığı gerekli.</div>;
                                    const km = endKm - startKm;
                                    const fuelsInRange = entries.filter(e => e.km > startKm && e.km <= endKm && e.liters > 0).sort((a,b) => a.km - b.km);
                                    const tankPct = parseTR(editTripForm.tankPercent) || 100;
                                    const startFuel = 40 * (tankPct / 100);
                                    const refueled = fuelsInRange.reduce((s, e) => s + e.liters, 0);
                                    const calcL100 = km > 0 ? ((startFuel + refueled) / km) * 100 : 0;
                                    return (
                                      <div>
                                        <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px" }}>
                                          <NumericInput value={editTripForm.tankPercent} onChange={v => setEditTripForm(p => ({ ...p, tankPercent: v }))} placeholder="100" style={{ ...editInp, width: "60px", flex: "none" }} />
                                          <span style={{ fontSize: "11px", color: "#8aa4c8" }}>% depo = {formatNumber(startFuel)} L</span>
                                        </div>
                                        <div style={{ fontSize: "11px", color: "#4a6080", marginBottom: "4px" }}>{fuelsInRange.length} dolum, +{formatNumber(refueled)} L → <span style={{ color: "#64d2ff", fontWeight: "700" }}>{formatNumber(calcL100)} L/100km</span></div>
                                        <button onClick={() => setEditTripForm(p => ({ ...p, consumption: toTR(calcL100) }))} style={{ width: "100%", background: "#1a2a45", border: "1px solid #64d2ff", color: "#64d2ff", padding: "6px", fontSize: "11px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "5px" }}>Kullan ✓</button>
                                      </div>
                                    );
                                  })()}
                                </div>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Litre Fiyatı ₺</div><NumericInput value={editTripForm.fuelPrice} onChange={v => setEditTripForm(p => ({ ...p, fuelPrice: v }))} style={editInp} /></div>
                                <div>
                                  <div style={{ ...lbl, marginBottom: "6px" }}>Otoyol Geçişleri</div>
                                  <button onClick={() => { setShowEditTollAdder(p => !p); setEditTollAddValue(""); setEditTollAddLabel(""); }} style={{ width: "100%", height: "44px", background: showEditTollAdder ? "#64d2ff" : "#1a2a45", border: "1px solid #2a3a55", color: showEditTollAdder ? "#000" : "#64d2ff", borderRadius: "6px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, marginBottom: "6px" }}>{showEditTollAdder ? "✕ İptal" : "+ Geçiş Ekle"}</button>
                                  {showEditTollAdder && (
                                    <div style={{ display: "flex", gap: "5px", marginBottom: "6px", alignItems: "center" }}>
                                      <input type="text" value={editTollAddLabel} onChange={ev => setEditTollAddLabel(ev.target.value)} placeholder="Geçiş adı" style={{ ...editInp, flex: 1.5, fontSize: "11px" }} />
                                      <NumericInput value={editTollAddValue} onChange={v => setEditTollAddValue(v)} placeholder="0,00" style={{ ...editInp, flex: 1 }} />
                                      <button onClick={() => { const add = parseTR(editTollAddValue); if (add > 0) { setEditTripForm(p => ({ ...p, tollItems: [...(p.tollItems||[]), { label: editTollAddLabel || `Geçiş ${(p.tollItems||[]).length+1}`, amount: add }] })); setShowEditTollAdder(false); setEditTollAddValue(""); setEditTollAddLabel(""); } }} style={{ background: "#44cc88", border: "1px solid #2a3a55", color: "#000", borderRadius: "6px", width: "36px", height: "36px", fontSize: "16px", fontWeight: "700", cursor: "pointer", flexShrink: 0, padding: 0 }}>✓</button>
                                    </div>
                                  )}
                                  {(editTripForm.tollItems||[]).length > 0 && (
                                    <div style={{ marginTop: "4px" }}>
                                      <div style={{ marginBottom: "4px" }}>
                                        <div style={{ ...lbl, marginBottom: "4px" }}>Toplam Otoyol Harcaması</div>
                                        <div style={{ ...editInp, cursor: "default" }}>{formatNumber((editTripForm.tollItems||[]).reduce((s,i) => s+i.amount,0))} ₺</div>
                                      </div>
                                      {(editTripForm.tollItems||[]).map((item, i) => (
                                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#080c14", borderRadius: "5px", marginBottom: "3px" }}>
                                          <span style={{ fontSize: "11px", color: "#8aa4c8" }}>{item.label}</span>
                                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                            <span style={{ fontSize: "12px", fontWeight: "700", color: "#ffdd00", fontFamily: MONO }}>{formatNumber(item.amount)} ₺</span>
                                            <button onClick={() => setEditTripForm(p => ({ ...p, tollItems: p.tollItems.filter((_,fi) => fi !== i) }))} style={{ background: "none", border: "none", color: "#ff4444", cursor: "pointer", fontSize: "13px", padding: "0 2px", lineHeight: 1 }}>✕</button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div><div style={{ ...lbl, marginBottom: "4px" }}>Not</div><input type="text" value={editTripForm.notes} onChange={ev => setEditTripForm(p => ({ ...p, notes: ev.target.value }))} style={editInp} /></div>
                                <div>
                                  <div style={{ ...lbl, marginBottom: "6px" }}>📷 Fotoğraf</div>
                                  {editTripForm.existingReceipts && editTripForm.existingReceipts.length > 0 && (
                                    <div style={{ marginBottom: "8px" }}>
                                      <div style={{ fontSize: "9px", color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Mevcut</div>
                                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>{editTripForm.existingReceipts.map((url, i) => (<div key={i} style={{ position: "relative" }}><a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="" style={{ width: "48px", height: "48px", objectFit: "cover", border: "1px solid #1a2a45", borderRadius: "6px" }} /></a><button onClick={() => setEditTripForm(p => ({ ...p, existingReceipts: p.existingReceipts.filter((_,fi) => fi !== i) }))} style={{ position: "absolute", top: "-6px", right: "-6px", background: "#ff4444", border: "none", borderRadius: "50%", width: "16px", height: "16px", color: "#fff", fontSize: "9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>✕</button></div>))}</div>
                                    </div>
                                  )}
                                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", background: "#080c14", border: "1px dashed #1a2a45", padding: "10px 12px", borderRadius: "8px", marginBottom: editTripReceiptPreviews.length > 0 ? "8px" : 0 }}>
                                    <input type="file" accept="image/*" multiple onChange={ev => { const newFiles = Array.from(ev.target.files); setEditTripReceiptFiles(f => [...f, ...newFiles]); setEditTripReceiptPreviews(p => [...p, ...newFiles.map(f => URL.createObjectURL(f))]); }} style={{ display: "none" }} />
                                    <span style={{ color: "#4a6080", fontSize: "12px" }}>+ Yeni fotoğraf ekle</span>
                                  </label>
                                  {editTripReceiptPreviews.length > 0 && <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>{editTripReceiptPreviews.map((src, i) => (<div key={i} style={{ position: "relative" }}><img src={src} alt="" style={{ width: "48px", height: "48px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "6px" }} /><button onClick={() => { setEditTripReceiptFiles(f => f.filter((_,fi) => fi !== i)); setEditTripReceiptPreviews(p => p.filter((_,pi) => pi !== i)); }} style={{ position: "absolute", top: "-6px", right: "-6px", background: "#ff4444", border: "none", borderRadius: "50%", width: "16px", height: "16px", color: "#fff", fontSize: "9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>✕</button></div>))}</div>}
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button onClick={handleEditTripSave} disabled={editTripSaving} style={{ background: "#64d2ff", color: "#000", border: "none", padding: "8px 20px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>{editTripSaving ? "Kaydediliyor..." : "Kaydet ✓"}</button>
                                <button onClick={() => setEditingTripId(null)} style={{ background: "transparent", color: "#888", border: "1px solid #1a2a45", padding: "8px 16px", fontSize: "12px", cursor: "pointer", fontFamily: FONT, borderRadius: "6px" }}>İptal</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 8px", flexWrap: "wrap", gap: "6px" }}>
                                <div>
                                  <div style={{ fontSize: "14px", fontWeight: "800", color: "#e8eef8" }}>{t.title || "Yolculuk"}</div>
                                  <div style={{ fontSize: "11px", color: "#4a6080", marginTop: "2px" }}>{fmtDate(t.date)}</div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  {(t.receipts && t.receipts.length > 0 ? t.receipts : []).map((url, i) => (<a key={i} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="foto" style={{ width: "30px", height: "30px", objectFit: "cover", border: "1px solid #64d2ff", borderRadius: "5px", display: "block" }} /></a>))}
                                  <button onClick={() => startEditTrip(t)} style={{ background: "none", border: "1px solid #1a2a45", color: "#666", cursor: "pointer", padding: "5px 9px", fontSize: "11px", fontFamily: FONT, borderRadius: "5px" }} onMouseEnter={ev => { ev.target.style.borderColor = "#64d2ff"; ev.target.style.color = "#64d2ff"; }} onMouseLeave={ev => { ev.target.style.borderColor = "#1a2a45"; ev.target.style.color = "#666"; }}>✎</button>
                                  <button onClick={() => handleDeleteTrip(t.id)} style={{ background: "none", border: "1px solid #1a2a45", color: "#3d5270", cursor: "pointer", padding: "5px 9px", fontSize: "12px", fontFamily: FONT, borderRadius: "5px" }} onMouseEnter={ev => { ev.target.style.borderColor = "#ff4444"; ev.target.style.color = "#ff4444"; }} onMouseLeave={ev => { ev.target.style.borderColor = "#1a2a45"; ev.target.style.color = "#3d5270"; }}>✕</button>
                                </div>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", borderTop: "1px solid #1a2a45" }}>
                                {[
                                  { label: "Mesafe", val: `${formatNumber(calc.km, 0)} km` },
                                  { label: "Yakıt L", val: `${formatNumber(calc.liters)} L` },
                                  { label: "Yakıt ₺", val: `${formatNumber(calc.fuelCost)} ₺` },
                                  { label: "Otoyol", val: `${formatNumber(t.tollCost)} ₺` },
                                  { label: "Toplam", val: `${formatNumber(calc.total)} ₺`, highlight: true },
                                ].map((col, ci) => (
                                  <div key={col.label} style={{ padding: "8px 4px", borderRight: ci < 4 ? "1px solid #1a2a45" : "none" }}>
                                    <div style={{ fontSize: "8px", fontWeight: "600", color: "#3d5270", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>{col.label}</div>
                                    <div style={{ fontSize: "12px", fontWeight: "700", color: col.highlight ? "#ff6655" : "#8aa4c8", fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>{col.val}</div>
                                  </div>
                                ))}
                              </div>
                              {t.notes && <div style={{ padding: "8px 14px", fontSize: "12px", color: "#4a6080", borderTop: "1px solid #1a2a45" }}>{t.notes}</div>}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
            }
          </div>
        )}

        {/* ===== GRAFİK ===== */}
        {!loading && activeTab === "graphs" && (() => {
          const byMonth = {};
          enriched.forEach(e => {
            const key = e.date.slice(0, 7);
            if (!byMonth[key]) byMonth[key] = { liters: 0, spent: 0, entries: [] };
            byMonth[key].liters += e.liters; byMonth[key].spent += e.totalPrice; byMonth[key].entries.push(e);
          });
          const monthKeys = Object.keys(byMonth).sort();
          const names = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
          const chartData = monthKeys.map(key => {
            const m = byMonth[key];
            const [y, mo] = key.split("-");
            const label = `${names[parseInt(mo) - 1]} ${y.slice(2)}`;
            const sortedE = [...m.entries].sort((a, b) => a.date.localeCompare(b.date));
            const monthKm = sortedE.length >= 2 ? sortedE[sortedE.length - 1].km - sortedE[0].km : null;
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
                            <Tooltip contentStyle={{ background: "#080c14", border: "1px solid #1a2a45", borderRadius: "6px", fontSize: "12px" }} labelStyle={{ color: "#888" }} itemStyle={{ color: c.color }} formatter={v => v != null ? [`${v} ${c.unit}`, c.label] : ["—", c.label]} />
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

        <div style={{ marginTop: "40px", paddingTop: "16px", borderTop: "1px solid #1a2a45", fontSize: "11px", color: "#1a2a45", textAlign: "center", fontWeight: "500" }}>
          Fuel Tracker — {entries.length} yakıt · {maintEntries.length} bakım · {tripEntries.length} yolculuk
        </div>
      </div>


      {/* FLOATING ACTION BUTTON */}
      {(activeTab === "fuel" || activeTab === "maintenance" || activeTab === "trips") && (
        <button
          onClick={() => {
            if (activeTab === "fuel") { setShowForm(p => { if (!p) setTimeout(() => document.getElementById("kayit-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); return !p; }); }
            if (activeTab === "maintenance") { setShowMaintForm(p => { if (!p) setTimeout(() => document.getElementById("maint-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); return !p; }); }
            if (activeTab === "trips") { setShowTripForm(p => { if (!p) setTimeout(() => document.getElementById("trip-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); return !p; }); }
          }}
          style={{
            position: "fixed",
            bottom: "calc(env(safe-area-inset-bottom) + 72px)",
            right: "20px",
            zIndex: 101,
            width: "52px", height: "52px",
            borderRadius: "50%",
            background: (activeTab === "fuel" && showForm) || (activeTab === "maintenance" && showMaintForm) || (activeTab === "trips" && showTripForm) ? "#1a2a45" : "#64d2ff",
            color: (activeTab === "fuel" && showForm) || (activeTab === "maintenance" && showMaintForm) || (activeTab === "trips" && showTripForm) ? "#64d2ff" : "#000",
            border: "none",
            fontSize: "26px",
            fontWeight: "300",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            transition: "all 0.2s ease",
            lineHeight: 1,
          }}
        >
          {(activeTab === "fuel" && showForm) || (activeTab === "maintenance" && showMaintForm) || (activeTab === "trips" && showTripForm) ? "✕" : "+"}
        </button>
      )}

      {/* BOTTOM TAB BAR */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100, background: "rgba(8,12,20,0.92)", borderTop: "1px solid #1a2a45", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", display: "flex", alignItems: "stretch", justifyContent: "center", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {[
          { id: "dashboard", emoji: "📊", label: "Panel" },
          { id: "fuel", emoji: "⛽", label: "Yakıt" },
          { id: "maintenance", emoji: "🔧", label: "Bakım" },
          { id: "trips", emoji: "🛣️", label: "Yolculuk" },
          { id: "graphs", emoji: "📈", label: "Grafik" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex: "0 1 20%", background: "none", border: "none", minWidth: 0, maxWidth: "20%", color: activeTab === tab.id ? "#64d2ff" : "#4a6080", fontFamily: FONT, cursor: "pointer", borderTop: activeTab === tab.id ? "2px solid #64d2ff" : "2px solid transparent", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px 0 20px", gap: "3px" }}>
            <span style={{ fontSize: "16px", lineHeight: 1 }}>{tab.emoji}</span>
            <span style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.2px", whiteSpace: "nowrap", overflow: "hidden", maxWidth: "100%", textAlign: "center" }}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
