# AS-UTS Perpustakaan Digital

Instruksi singkat untuk menjalankan proyek ini secara lokal.

1. Install dependensi:

```powershell
cd d:\AS-UTS\AS-UTS
npm install
```

2. Jalankan server (mode pengujian):

```powershell
# Menjalankan server secara langsung (hanya bind ke localhost)
$env:TEST_MODE='true'; node server.js

# Atau jalankan sebagai background process dan izinkan akses jaringan (HATI-HATI di publik)
$env:TEST_MODE='true'; $env:ALLOW_PUBLIC='true'; Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory 'd:\AS-UTS\AS-UTS' -WindowStyle Hidden -PassThru
```

3. Buka frontend di browser:

- http://localhost:3001/AS-uts.html

VS Code - One click debug
1. Buka folder `d:\AS-UTS\AS-UTS` di VS Code.
2. Buka panel Run and Debug, pilih kompound "Server + Browser", lalu tekan F5.

4. Catatan keamanan:
- TEST_MODE bypass autentikasi (hanya untuk pengujian lokal).
- Matikan ALLOW_PUBLIC kecuali Anda sudah mengamankan server dengan TLS, proxy, dan validasi token.

5. Database:
- Proyek menggunakan SQLite file-based di `data/db.sqlite`.

6. NPM scripts
- `npm start` untuk menjalankan server
- `npm run dev` untuk menjalankan server dengan TEST_MODE pada Windows (CMD/PowerShell)

