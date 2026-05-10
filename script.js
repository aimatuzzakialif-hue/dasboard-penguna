/* =========================================================
   JADWAL AMBULANS — Dashboard Pengguna
   script.js  |  Firebase Realtime Database + Kalender
   ========================================================= */

'use strict';

/* ── Firebase Config ────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            "AIzaSyAda9pQw4S33sHdY_B3O17ROSzZA2tGzWY",
  authDomain:        "dasboard-penguna.firebaseapp.com",
  databaseURL:       "https://dasboard-penguna-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "dasboard-penguna",
  storageBucket:     "dasboard-penguna.firebasestorage.app",
  messagingSenderId: "1037039071776",
  appId:             "1:1037039071776:web:b679010217ddfc4eea4245",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* ── State Global ───────────────────────────────────────── */
let selectedIso    = null;   // "2026-05-03"
let calendarDate   = null;   // Date object bulan yang sedang ditampilkan di kalender
let activeListeners = [];    // array { ref, fn } untuk dilepas saat ganti tanggal
let allJadwalData  = {};     // cache semua data jadwal dari Firebase { "2026-05-03": {...}, ... }
let jadwalListener = null;   // listener utama untuk seluruh node /jadwal

/* =========================================================
   HELPER TANGGAL
   ========================================================= */

function dateToIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatPanjang(date) {
  return date.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatBulanTahun(date) {
  return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/*
 * Firebase menyimpan jadwal dengan DUA format kunci tanggal:
 *   - ISO baru  : "2026-05-03"
 *   - Format lama: "Minggu 3 Mei 2026" atau "Minggu, 3 Mei 2026"
 * Fungsi ini normalisasi semua format ke ISO agar bisa di-match.
 */
function normalisiKeIso(keyFirebase) {
  // Jika sudah ISO (yyyy-mm-dd)
  if (/^\d{4}-\d{2}-\d{2}$/.test(keyFirebase)) return keyFirebase;

  // Coba parse format panjang bahasa Indonesia
  try {
    const bersih = keyFirebase.replace(',', '').trim();
    // contoh: "Minggu 3 Mei 2026"
    const bulanMap = {
      januari:1, februari:2, maret:3, april:4, mei:5, juni:6,
      juli:7, agustus:8, september:9, oktober:10, november:11, desember:12,
    };
    const parts = bersih.split(' ').filter(Boolean);
    // cari angka hari dan nama bulan
    let hari = null, bulan = null, tahun = null;
    parts.forEach(p => {
      if (/^\d{1,2}$/.test(p) && !hari) hari = parseInt(p);
      else if (/^\d{4}$/.test(p)) tahun = parseInt(p);
      else if (bulanMap[p.toLowerCase()]) bulan = bulanMap[p.toLowerCase()];
    });
    if (hari && bulan && tahun) {
      return `${tahun}-${String(bulan).padStart(2,'0')}-${String(hari).padStart(2,'0')}`;
    }
  } catch(e) {}
  return null; // tidak dikenali
}
  function formatJam(raw) {
  if (!raw) return '--:--';

  // Jika sudah format HH:MM atau HH:MM:SS
  if (/^\d{2}:\d{2}/.test(raw)) return raw.slice(0, 5);

  // Jika format ISO datetime (2026-05-13T00:00:00.000Z)
  if (raw.includes('T')) {
    try {
      const date = new Date(raw);
      // Konversi ke waktu lokal Indonesia (WIB = UTC+7)
      const jamWIB = new Date(date.getTime() + (7 * 60 * 60 * 1000));
      const h = String(jamWIB.getUTCHours()).padStart(2, '0');
      const m = String(jamWIB.getUTCMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    } catch(e) {}
  }

  return '--:--';
}

/* =========================================================
   FIREBASE — LISTEN SELURUH /jadwal SEKALIGUS
   Ini yang membuat data bisa diakses dari tanggal kapan pun
   termasuk data lama, tanpa perlu query per tanggal.
   ========================================================= */

function initFirebaseListener() {
  tampilkanLoading();

  // Listen ke seluruh node /jadwal (realtime)
  jadwalListener = db.ref('jadwal').on('value', snap => {
    allJadwalData = {}; // reset cache

    if (snap.exists()) {
      snap.forEach(tanggalSnap => {
        const rawKey = tanggalSnap.key;          // kunci asli di Firebase
        const isoKey = normalisiKeIso(rawKey);   // normalisasi ke ISO
        if (!isoKey) return;                     // abaikan jika tidak bisa di-parse

        if (!allJadwalData[isoKey]) allJadwalData[isoKey] = {};

        tanggalSnap.forEach(itemSnap => {
          // Gabungkan semua item dari semua format kunci ke dalam satu ISO key
          allJadwalData[isoKey][itemSnap.key] = {
            ...itemSnap.val(),
            _fbPath: `jadwal/${rawKey}/${itemSnap.key}`, // simpan path asli untuk edit/hapus
          };
        });
      });
    }

    // Re-render kalender (agar titik data muncul)
    renderKalender();

    // Re-render jadwal tanggal yang sedang dipilih
    if (selectedIso) {
      tampilkanData(allJadwalData[selectedIso] || {});
    }

  }, err => {
    tampilkanError('Gagal koneksi Firebase: ' + err.message);
  });
}

/* =========================================================
   KALENDER
   ========================================================= */

function renderKalender() {
  const cal = document.getElementById('kalender');
  if (!cal) return;

  const tahun  = calendarDate.getFullYear();
  const bulan  = calendarDate.getMonth(); // 0-based
  const today  = new Date(); today.setHours(0,0,0,0);
  const todayIso = dateToIso(today);

  // Hari pertama bulan ini & jumlah hari
  const hariPertama = new Date(tahun, bulan, 1).getDay(); // 0=Minggu
  const jumlahHari  = new Date(tahun, bulan + 1, 0).getDate();

  // Offset: mulai Senin (0=Sen, 6=Min)
  const offset = (hariPertama === 0) ? 6 : hariPertama - 1;

  const namaHari = ['Sen','Sel','Rab','Kam','Jum','Sab','Min'];

  let html = '';

  // Header nama hari
  html += `<div class="kal-header-hari">`;
  namaHari.forEach(h => { html += `<div class="kal-nama-hari">${h}</div>`; });
  html += `</div><div class="kal-grid">`;

  // Sel kosong sebelum hari pertama
  for (let i = 0; i < offset; i++) {
    html += `<div class="kal-sel kal-kosong"></div>`;
  }

  // Sel tiap hari
  for (let d = 1; d <= jumlahHari; d++) {
    const isoHari = `${tahun}-${String(bulan+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const adaData = allJadwalData[isoHari] && Object.keys(allJadwalData[isoHari]).length > 0;
    const isToday = isoHari === todayIso;
    const isSelected = isoHari === selectedIso;

    let kelas = 'kal-sel';
    if (isSelected) kelas += ' kal-selected';
    else if (isToday) kelas += ' kal-today';

    html += `<div class="${kelas}" onclick="pilihTanggal('${isoHari}')">
      <span class="kal-angka">${d}</span>
      ${adaData ? `<span class="kal-dot"></span>` : ''}
    </div>`;
  }

  html += `</div>`;
  cal.innerHTML = html;
}

function navigasiBulan(delta) {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + delta, 1);
  document.getElementById('labelBulan').textContent = formatBulanTahun(calendarDate);
  renderKalender();
}

function pilihTanggal(isoKey) {
  selectedIso = isoKey;
  const date  = isoToDate(isoKey);

  // Update label tanggal di header
  document.getElementById('tanggal').textContent = formatPanjang(date);

  // Re-render kalender agar highlight berpindah
  renderKalender();

  // Tampilkan data jadwal tanggal tersebut
  tampilkanData(allJadwalData[isoKey] || {});
}

/* =========================================================
   RENDER JADWAL
   ========================================================= */

function tampilkanLoading() {
  const el = document.getElementById('jadwal');
  if (el) el.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div class="loading-text">Menghubungkan ke Firebase...</div>
    </div>`;
  const badge = document.getElementById('badge-total');
  if (badge) badge.textContent = '0';
}

function tampilkanError(msg) {
  const el = document.getElementById('jadwal');
  if (el) el.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <div class="empty-text">Gagal memuat data</div>
      <div class="empty-sub">${msg}</div>
    </div>`;
}

function tampilkanData(data) {
  const container = document.getElementById('jadwal');
  if (!container) return;

  const items = Object.entries(data || {});

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🗓</div>
        <div class="empty-text">Belum ada jadwal</div>
        <div class="empty-sub">Tidak ada perjalanan untuk tanggal ini.</div>
      </div>`;
    document.getElementById('badge-total').textContent = '0';
    return;
  }

  // Urutkan: darurat → menunggu → selesai, lalu jam
  const urutan = { darurat:0, emergency:0, menunggu:1, pending:1, selesai:2, done:2 };
  items.sort(([,a],[,b]) => {
    const pa = urutan[(a.status||'menunggu').toLowerCase()] ?? 1;
    const pb = urutan[(b.status||'menunggu').toLowerCase()] ?? 1;
    if (pa !== pb) return pa - pb;
    return (a.jam||'').localeCompare(b.jam||'');
  });

  const ikonJenis = { pasien:'🏥', jenazah:'🏳️', emergency:'🚨' };

  container.innerHTML = items.map(([key, item]) => {
    const status   = (item.status || 'menunggu').toLowerCase();
    const jenis    = (item.jenis  || 'pasien').toLowerCase();
    const fbPath   = item._fbPath || '';

    let cardKelas = 'menunggu';
    if (status === 'darurat' || status === 'emergency' || jenis === 'emergency') cardKelas = 'darurat';
    else if (status === 'selesai' || status === 'done') cardKelas = 'selesai';

    const ikon     = ikonJenis[jenis] || '🚑';
    // Pangkas URL peta jika ada di field "dari"
    const dariTeks = (item.dari || '-').split('|')[0].trim();
    const tujuan   = item.tujuan || '-';
    const jam = formatJam(item.jam);

    return `
      <div class="card ${cardKelas}" data-key="${key}">
        <div class="card-header">
          <div class="card-jam-besar">
            <span class="jam-icon">⏰</span>
            <span class="jam-teks">${jam}</span>
          </div>
          <span class="badge-jenis badge-${jenis}">${ikon} ${capitalize(item.jenis || 'Pasien')}</span>
        </div>

        <div class="card-nama">${item.nama || '-'}</div>

        <div class="card-info-grid">
          <div class="card-info-item">
            <span class="info-label">📍 Alamat Jemput</span>
            <span class="info-val">${dariTeks}</span>
          </div>
          <div class="card-info-item">
            <span class="info-label">🏥 RS / Tujuan</span>
            <span class="info-val info-tujuan">${tujuan}</span>
          </div>
        </div>

        <div class="card-footer">
          <span class="status-pill status-${cardKelas}">${capitalize(status)}</span>
          <div class="card-actions">
            <button class="btn-aksi btn-selesai" onclick="ubahStatus('${fbPath}','selesai')">✓ Selesai</button>
            <button class="btn-aksi btn-hapus"   onclick="hapusItem('${fbPath}')">✕</button>
          </div>
        </div>
      </div>`;
  }).join('');

  document.getElementById('badge-total').textContent = items.length;
}

/* =========================================================
   AKSI — pakai _fbPath (path asli di Firebase)
   ========================================================= */

function ubahStatus(fbPath, statusBaru) {
  if (!fbPath) return;
  db.ref(fbPath + '/status').set(statusBaru)
    .then(() => tampilkanToast('Status diperbarui ✓', 'success'))
    .catch(err => tampilkanToast('Gagal: ' + err.message, 'error'));
}

function hapusItem(fbPath) {
  if (!fbPath) return;
  if (!confirm('Hapus jadwal ini?')) return;
  db.ref(fbPath).remove()
    .then(() => tampilkanToast('Jadwal dihapus.', 'success'))
    .catch(err => tampilkanToast('Gagal hapus: ' + err.message, 'error'));
}

/* =========================================================
   TOAST
   ========================================================= */

function tampilkanToast(msg, tipe = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${tipe}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

/* =========================================================
   INIT
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  selectedIso  = dateToIso(today);
  calendarDate = new Date(today.getFullYear(), today.getMonth(), 1);

  // Set label bulan & tanggal awal
  document.getElementById('labelBulan').textContent = formatBulanTahun(calendarDate);
  document.getElementById('tanggal').textContent    = formatPanjang(today);

  // Render kalender (kosong dulu, akan diisi setelah Firebase respond)
  renderKalender();

  // Hubungkan ke Firebase — listener realtime untuk seluruh /jadwal
  initFirebaseListener();
});