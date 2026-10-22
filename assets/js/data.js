/* Veri katmanı: Supabase ayarlıysa gerçek veritabanını, değilse tarayıcıda DEMO verisini kullanır. */
(function () {
  const C = window.SITE_CONFIG;
  const TZ = C.timeZone || "Europe/Istanbul";
  const useSupabase = !!(C.supabaseUrl && C.supabaseAnonKey && window.supabase);
  const sb = useSupabase ? window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey) : null;

  /* ---------- Biçimlendirme yardımcıları ---------- */
  const fmt = {
    dayKey(iso) { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); },
    time(iso) { return new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); },
    dateLong(iso) { return new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso)); },
    dateShort(iso) { return new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso)); },
    weekdayShort(iso) { return new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, weekday: "short" }).format(new Date(iso)); },
    dayNum(iso) { return new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "numeric" }).format(new Date(iso)); },
    monthShort(iso) { return new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, month: "short" }).format(new Date(iso)); },
    typeLabel(t) { return t === "online" ? "Online" : t === "ikisi" ? "Online / Yüz yüze" : "Yüz yüze"; },
    typeClass(t) { return t === "online" ? "online" : t === "ikisi" ? "both" : "inperson"; },
    // Bir saat, istenen türü karşılıyor mu? ("ikisi" her iki türü de karşılar)
    fits(slotType, want) { return want === "all" || slotType === want || slotType === "ikisi"; },
    // İstanbul sabit UTC+3 (2016'dan beri yaz saati yok)
    toIso(dateStr, timeStr) { return new Date(`${dateStr}T${timeStr}:00+03:00`).toISOString(); },
    todayKey() { return fmt.dayKey(new Date().toISOString()); }
  };

  /* ---------- DEMO deposu ---------- */
  const DEMO_KEY = "psk_demo_v1";
  let mem = null;
  function demoLoad() {
    if (mem) return mem;
    try { const raw = localStorage.getItem(DEMO_KEY); if (raw) { mem = JSON.parse(raw); return mem; } } catch (e) {}
    mem = demoSeed(); demoSave(); return mem;
  }
  function demoSave() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(mem)); } catch (e) {} }
  function uid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())); }
  function demoSeed() {
    const slots = [], bookings = [];
    const base = new Date();
    for (let d = 1; d <= 16; d++) {
      const day = new Date(base.getTime() + d * 86400000);
      const key = fmt.dayKey(day.toISOString());
      const wd = new Date(`${key}T12:00:00+03:00`).getUTCDay(); // 0 pazar
      if (wd === 0) continue;
      const times = wd === 6 ? ["10:00", "11:00", "12:00"] : ["10:00", "11:00", "13:00", "14:00", "16:00", "17:00", "18:00", "19:00"];
      times.forEach((t, i) => {
        const type = t >= "18:00" ? "online" : (i % 3 === 0 ? "ikisi" : (wd === 2 || wd === 4 ? "online" : "yuzyuze"));
        const starts = fmt.toIso(key, t);
        slots.push({ id: uid(), starts_at: starts, ends_at: new Date(new Date(starts).getTime() + C.sessionMinutes * 60000).toISOString(), type, status: "available" });
      });
    }
    // Örnek dolu seanslar
    [2, 7, 12].forEach((idx, n) => {
      const s = slots[idx]; if (!s) return; s.status = "booked";
      bookings.push({ id: uid(), slot_id: s.id, starts_at: s.starts_at, type: s.type, status: "onayli",
        name: ["Örnek Danışan A", "Örnek Danışan B", "Örnek Danışan C"][n], phone: "+90 5XX XXX XX XX", email: "ornek@ornek.com",
        note: "Demo kaydı", created_at: new Date().toISOString() });
    });
    return { slots, bookings };
  }

  /* ---------- Ortak API ---------- */
  const Data = {
    mode: useSupabase ? "supabase" : "demo",
    fmt,

    async listAvailableSlots() {
      const nowIso = new Date().toISOString();
      if (sb) {
        const { data, error } = await sb.from("slots").select("id,starts_at,ends_at,type")
          .eq("status", "available").gt("starts_at", nowIso).order("starts_at").limit(500);
        if (error) throw error; return data;
      }
      return demoLoad().slots.filter(s => s.status === "available" && s.starts_at > nowIso)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },

    async book(slotId, f) {
      if (sb) {
        const { data, error } = await sb.rpc("book_slot", { p_slot: slotId, p_name: f.name, p_phone: f.phone, p_email: f.email || null, p_note: f.note || null, p_type: f.type || null });
        if (error) { if ((error.message || "").includes("slot_unavailable")) return { ok: false, reason: "taken" }; throw error; }
        return { ok: true, id: data };
      }
      const db = demoLoad(); const s = db.slots.find(x => x.id === slotId);
      if (!s || s.status !== "available") return { ok: false, reason: "taken" };
      s.status = "booked";
      const chosen = s.type === "ikisi" ? (f.type || "online") : s.type;
      db.bookings.push({ id: uid(), slot_id: s.id, starts_at: s.starts_at, type: chosen, status: "onayli", name: f.name, phone: f.phone, email: f.email, note: f.note, created_at: new Date().toISOString() });
      demoSave(); return { ok: true };
    },

    /* ---- Yönetici ---- */
    async session() {
      if (sb) { const { data } = await sb.auth.getSession(); return data.session; }
      try { return sessionStorage.getItem("psk_demo_admin") ? { demo: true } : null; } catch (e) { return mem && mem._admin ? { demo: true } : null; }
    },
    async signIn(email, password) {
      if (sb) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return; }
      try { sessionStorage.setItem("psk_demo_admin", "1"); } catch (e) { demoLoad()._admin = true; }
    },
    async signOut() {
      if (sb) { await sb.auth.signOut(); return; }
      try { sessionStorage.removeItem("psk_demo_admin"); } catch (e) {} if (mem) mem._admin = false;
    },
    async listSlots(fromIso) {
      if (sb) {
        const { data, error } = await sb.from("slots").select("*").gte("starts_at", fromIso).order("starts_at").limit(1000);
        if (error) throw error; return data;
      }
      return demoLoad().slots.filter(s => s.starts_at >= fromIso).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },
    async createSlots(rows) {
      if (sb) { const { error } = await sb.from("slots").insert(rows); if (error) throw error; return; }
      const db = demoLoad(); rows.forEach(r => db.slots.push({ id: uid(), status: "available", ...r })); demoSave();
    },
    async updateSlot(id, patch) {
      if (sb) { const { error } = await sb.from("slots").update(patch).eq("id", id); if (error) throw error; return; }
      const s = demoLoad().slots.find(x => x.id === id); if (s) Object.assign(s, patch); demoSave();
    },
    async updateSlots(ids, patch) {
      if (!ids.length) return;
      if (sb) { const { error } = await sb.from("slots").update(patch).in("id", ids).eq("status", "available"); if (error) throw error; return; }
      demoLoad().slots.forEach(x => { if (ids.includes(x.id) && x.status === "available") Object.assign(x, patch); }); demoSave();
    },
    async deleteSlot(id) {
      if (sb) { const { error } = await sb.from("slots").delete().eq("id", id).neq("status", "booked"); if (error) throw error; return; }
      const db = demoLoad(); db.slots = db.slots.filter(x => !(x.id === id && x.status !== "booked")); demoSave();
    },
    async listBookings() {
      if (sb) {
        const { data, error } = await sb.from("bookings").select("*").order("starts_at", { ascending: true }).limit(1000);
        if (error) throw error; return data;
      }
      return [...demoLoad().bookings].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },
    async setBookingStatus(id, status) {
      if (sb) {
        const { error } = await sb.rpc("admin_set_booking_status", { p_booking: id, p_status: status });
        if (error) throw error; return;
      }
      const db = demoLoad(); const b = db.bookings.find(x => x.id === id); if (!b) return;
      b.status = status;
      const s = db.slots.find(x => x.id === b.slot_id);
      if (s) s.status = status === "iptal" ? "available" : "booked";
      demoSave();
    },
    resetDemo() { mem = demoSeed(); demoSave(); },

    /* ---- Testler / envanterler ---- */
    async loadForms() {
      const r = await fetch("assets/forms/forms.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("forms"); return (await r.json()).forms;
    },
    // Puanlama: ölçekler için toplam × çarpan, şiddet bandı ve uyarı bayrakları
    scoreForm(form, answers) {
      if (form.kind !== "scale") return { score: null, severity: null, flags: [] };
      const raw = answers.reduce((a, v) => a + (+v || 0), 0);
      const sc = form.scoring || {}, score = raw * (sc.multiplier || 1);
      const band = (sc.bands || []).find(b => score <= b.max);
      const flags = (sc.flags || []).filter(f => (+answers[f.item - 1] || 0) >= f.min).map(f => f.label);
      return { score, max: form.items.length * Math.max(...form.options.map(o => o.value)) * (sc.multiplier || 1), severity: band ? band.label : null, flags };
    },
    async submitAssessment(payload) {
      if (sb) {
        const { data, error } = await sb.functions.invoke("submit-assessment", { body: payload });
        if (error) throw error; return data;
      }
      const forms = await Data.loadForms(), form = forms.find(f => f.id === payload.form_id);
      const r = Data.scoreForm(form, payload.answers);
      const db = demoLoad(); db.assessments = db.assessments || [];
      db.assessments.unshift({ id: uid(), form_id: form.id, form_title: form.title, name: payload.name, email: payload.email, phone: payload.phone,
        answers: payload.answers, score: r.score, severity: r.severity, flags: r.flags, created_at: new Date().toISOString() });
      demoSave(); return { ok: true, demo: true, flagged: r.flags.length > 0 };
    },
    async listAssessments() {
      if (sb) {
        const { data, error } = await sb.from("assessments").select("*").order("created_at", { ascending: false }).limit(500);
        if (error) throw error; return data;
      }
      return demoLoad().assessments || [];
    }
  };

  window.Data = Data;
})();
