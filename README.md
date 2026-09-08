# 🎬 Watch Party App (Aplikasi Nobar Real-time)

Aplikasi Watch Party Full-Stack yang memungkinkan banyak pengguna menonton video (MP4, HLS/M3U8) secara bersamaan dalam satu room dengan sinkronisasi playback yang sangat akurat.

## 🚀 Fitur Utama
- **Universal Media Player**: Mendukung video MP4 langsung, Native HLS (Safari), dan custom HLS (via `hls.js`).
- **Advanced Sync Engine**: Sinkronisasi waktu menggunakan Server Timestamp, toleransi latensi jaringan (RTT), koreksi *drift* otomatis dengan *playback rate adjustment*, dan hard-seek fallback.
- **Host & Queue System**: Host memiliki kontrol penuh (Play, Pause, Seek). Mendukung sistem Playlist/Queue (Next, Previous, Auto Play Next).
- **Social Features**: Real-time Chat (dengan timestamp video) dan animasi floating reaction (Emoji).
- **Room Isolation**: Mendukung banyak room secara bersamaan dengan state yang terisolasi.

---

## 📁 Struktur Project

```text
watch-party/
├── server.ts                       # Backend entry point (Express, Socket.IO, Vite Middleware)
├── src/
│   ├── components/                 # UI Components (React)
│   │   ├── UniversalPlayer.tsx     # Player wrapper untuk HTML5 & hls.js
│   │   ├── QueuePanel.tsx          # UI Sidebar untuk Playlist/Queue
│   │   ├── ChatPanel.tsx           # UI Sidebar untuk Chat & Reaction
│   │   └── ReactionLayer.tsx       # Animasi floating emoji
│   ├── pages/
│   │   ├── Home.tsx                # Halaman utama (Create/Join/Daftar Room)
│   │   └── Room.tsx                # Halaman Utama Watch Party
│   ├── player/
│   │   └── SyncEngine.ts           # Mesin kalkulasi sinkronisasi waktu dan drift
│   ├── server/
│   │   ├── db.ts                   # Konfigurasi SQLite (better-sqlite3)
│   │   └── roomManager.ts          # State Machine untuk server-side room & antrean (queue)
│   ├── stores/
│   │   └── useRoomStore.ts         # State management frontend (Zustand)
│   ├── types/
│   │   └── index.ts                # TypeScript Interfaces
│   └── main.tsx                    # Entry point aplikasi React
├── dist/                           # Hasil build produksi (di-generate setelah build)
├── .env.example                    # Contoh Environment variable
└── package.json                    # Konfigurasi dependency dan script npm
```

---

## ⚙️ Persiapan & Instalasi

### 1. Prerequisites
- Node.js versi 18 atau lebih baru.
- npm atau pnpm.

### 2. Instalasi Commands
Jalankan perintah berikut di terminal:
```bash
npm install
```

### 3. Konfigurasi Environment
Salin file `.env.example` menjadi `.env` jika Anda ingin mengubah environment variabel default.
```bash
cp .env.example .env
```
Isi konfigurasi (Opsional):
```env
PORT=3000
NODE_ENV=development # Gunakan 'production' saat deploy
```

### 4. Database Setup
Aplikasi menggunakan **`better-sqlite3`**. Anda tidak perlu menginstall database terpisah (seperti MySQL/PostgreSQL).
- Saat `NODE_ENV=development`: Database berjalan secara **in-memory** untuk kecepatan development.
- Saat `NODE_ENV=production`: Database otomatis akan membuat file `data.sqlite` di root direktori untuk menyimpan riwayat rooms, queue, dan settings.

---

## 💻 Development & Production

### Development Command
Untuk menjalankan mode pengembangan dengan Hot Module Replacement (HMR) dan server backend terintegrasi:
```bash
npm run dev
```
Akses di browser: `http://localhost:3000`

### Build Command
Untuk mengkompilasi React dan mem-bundle backend (`server.ts`) menjadi file mandiri:
```bash
npm run build
```
Perintah ini akan menghasilkan file statis frontend dan file backend `dist/server.cjs`.

### Production Command
Setelah menjalankan build, jalankan aplikasi menggunakan Node native:
```bash
NODE_ENV=production PORT=3000 npm start
```

---

## 🏗️ Penjelasan Arsitektur

### Socket.IO Architecture
Server backend (`server.ts`) bertindak sebagai **Authoritative Source of Truth**. Semua perubahan pada pemutaran video (Play, Pause, Seek) atau antrean (Queue) tidak langsung diterapkan oleh client.
1. Client menekan "Pause".
2. Event `player:pause` dikirim ke server.
3. Server memvalidasi permission (Host/Owner).
4. Server memperbarui internal state dan menetapkan `serverTimestamp` terbaru.
5. Server mengirim `room:sync` ke *semua* partisipan di room tersebut.
6. Client menerapkan "Pause".

Server juga melakukan **Periodic Authoritative Sync** (Heartbeat) setiap beberapa detik ke seluruh room untuk mencegah client tertinggal akibat missed events.

### Synchronization Architecture
`SyncEngine` (`src/player/SyncEngine.ts`) dirancang untuk sinkronisasi sub-detik di berbagai kondisi jaringan:
- **Ping/Pong Offset**: Saat masuk room, client mem-ping server untuk menghitung RTT (Round Trip Time) dan perbedaan waktu jam lokal vs server (Clock Offset).
- **Expected Position**: Posisi video selalu dihitung berdasarkan rumus: `posisi_terakhir + ((waktu_server_sekarang - waktu_update_terakhir) / 1000 * playbackRate)`.
- **Drift Correction**: 
  - Jika video client selisih 100ms - 500ms, `SyncEngine` akan memutar video lebih cepat (`1.05x`) atau lebih lambat (`0.95x`) untuk mengejar ketertinggalan tanpa patah-patah (*stuttering*).
  - Jika selisih ekstrim (> 500ms), dilakukan *hard-seek* paksa.

### Media Player Architecture
`UniversalPlayer` (`src/components/UniversalPlayer.tsx`) mendeteksi sumber video (URL) secara cerdas:
- Jika URL adalah `.m3u8` dan browser membutuhkan polyfill, `hls.js` akan diinisialisasi.
- HLS.js dikonfigurasi dengan *low-latency mode*, *automatic error recovery*, dan resolusi adaptif.
- Memisahkan secara ketat *user-initiated control* (yang harus dilaporkan ke server) dengan *system-initiated control* (seperti `syncEngine` yang mengoreksi drift).

---

## 🧪 Testing Instructions

Untuk menguji kehandalan sinkronisasi, simulasikan hal berikut:
1. **Multi-user Sync**: Buka 2 tab browser berbeda (atau beda device). Jadikan Tab 1 sebagai Host dan Tab 2 sebagai Viewer. Ubah durasi (seek) di Tab 1, pastikan Tab 2 mengikuti secara instan.
2. **Late Joiner**: Putar video hingga menit tertentu. Buka jendela Incognito baru dan join menggunakan *Room Code*. User baru harus langsung melompat ke menit video tersebut (bukan dari 00:00).
3. **Network Throttle (Simulasi Lag)**: Di browser Viewer, buka *DevTools > Network*, ubah ke "Fast 3G". Perhatikan bahwa video mungkin sedikit lambat, namun `SyncEngine` akan mengubah kecepatan (`playbackRate` ke 1.05) hingga posisinya kembali sejajar dengan Host.

---

## 🌍 Deployment Instructions

Proyek ini sangat mudah di-deploy di VPS (seperti DigitalOcean, Linode, AWS EC2, atau Railway):
1. Clone repositori ke VPS Anda.
2. Jalankan `npm install`.
3. Jalankan `npm run build` untuk memproduksi aplikasi.
4. Gunakan process manager seperti **PM2**:
   ```bash
   npm install -g pm2
   NODE_ENV=production pm2 start npm --name "watchparty" -- start
   ```
5. Konfigurasikan Nginx sebagai reverse proxy untuk meneruskan traffic dari port 80/443 (Domain Anda) ke port `3000` milik Node.js. Pastikan Anda mengaktifkan konfigurasi untuk WebSocket (`Upgrade` header) di Nginx.

---

## ⚠️ Known Browser Limitations (Keterbatasan Browser)

1. **Auto-play Policy (Pemutaran Otomatis)**: 
   Browser modern (Chrome, Safari, Firefox) memblokir video untuk diputar secara otomatis dengan suara jika pengguna belum berinteraksi dengan halaman web tersebut. Pengguna mungkin harus melakukan klik setidaknya sekali di halaman agar sinkronisasi "Play" bisa berjalan.
2. **CORS (Cross-Origin Resource Sharing)**: 
   Aplikasi ini dapat memutar URL video manapun, tetapi server asal video tersebut **harus memiliki header CORS yang mengizinkan pemutaran**. Jika Anda memasukkan link MP4/M3U8 dari server yang diblokir CORS, HLS.js atau HTML5 player akan memunculkan *Network Error*.
3. **Mobile Background Throttling**:
   iOS Safari dan Android Chrome sering menghentikan eksekusi JavaScript secara paksa ketika aplikasi masuk ke *background* (beralih tab). `UniversalPlayer` menggunakan event `visibilitychange` untuk melakukan *resync* paksa ketika pengguna kembali membuka tab aplikasi.
