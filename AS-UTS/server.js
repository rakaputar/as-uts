// Backend Perpustakaan Digital
// Jalankan: npm install express sqlite3 jsonwebtoken cors

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const http = require('http');
const https = require('https');
const url = require('url');

// Keycloak configuration (optional)
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || '';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'perpustakaan';
const KEYCLOAK_CLIENT = process.env.KEYCLOAK_CLIENT || 'perpus-web';

// Inisialisasi database SQLite (file-based agar persist)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'db.sqlite');
// pastikan direktori ada
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama TEXT,
        email TEXT,
        role TEXT,
        keycloak_id TEXT,
        password TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS buku (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        judul TEXT,
        penulis TEXT,
        tahun INTEGER,
        stok INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS peminjaman (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        buku_id INTEGER,
        tanggal_pinjam TEXT,
        tanggal_kembali TEXT,
        status TEXT
    )`);

    // seed contoh data buku untuk pengujian lokal hanya jika tabel buku kosong
    db.get('SELECT COUNT(*) AS cnt FROM buku', (err, row) => {
        if (err) {
            console.error('Gagal cek tabel buku:', err.message);
            return;
        }
        if (!row || row.cnt === 0) {
            db.run('INSERT INTO buku (judul, penulis, tahun, stok) VALUES (?, ?, ?, ?)', ['Belajar Node.js', 'Penulis A', 2020, 3]);
            db.run('INSERT INTO buku (judul, penulis, tahun, stok) VALUES (?, ?, ?, ?)', ['Pemrograman Web', 'Penulis B', 2019, 2]);
            console.log('Seed data buku dimasukkan');
        }
    });
    // pastikan kolom password ada pada tabel user (untuk register demo)
    db.all("PRAGMA table_info(user)", (err, cols) => {
        if (!err && cols) {
            const hasPassword = cols.some(c => c.name === 'password');
            if (!hasPassword) {
                db.run('ALTER TABLE user ADD COLUMN password TEXT', (er) => {
                    if (er) console.warn('Gagal menambahkan kolom password:', er.message);
                });
            }
        }
    });
});

// Middleware verifikasi JWT Keycloak
function verifyKeycloakToken(req, res, next) {
    // Untuk pengujian lokal set TEST_MODE=true sebelum menjalankan node
    if (process.env.TEST_MODE === 'true') {
        req.user = { sub: 1, realm_access: { roles: ['admin'] } };
        return next();
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];

    // Public key harus dalam format PEM. Ganti dengan public key Keycloak Anda jika diperlukan.
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsdW1XFTeA3VxFfvvpiLG8
15w+KlcAOXQVF0Zv2V9ToGhg/yyNK4ZXJ8ZifcBGmcSBscInTd1Y8F9l7GYiLSnuG
tAIBuAttBmet/80YnwNwDoaj6hTbDDtTQTAYm60gaBf/Lo6FejwOHqn+vLLvoSzON
ORmcOpsUDCtw2frae4/WJsfPPxbVOFeMRwHMVVwUtWojHOCkaULbHAsn23WKYpgnz
n40TkDhXsUeKOCa/JBVKl6LP2WAefDkBYLLaBgSXyTlAZSHGNxd8OVB1NG9KUBt+8
w8fXb7S9C/4BpWg5OU1K7lbzzE6p5bXgUYKU/tCsqOMew7UdxmGV8NoZ5CvdwIDAQAB
-----END PUBLIC KEY-----`;

    jwt.verify(token, publicKeyPem, { algorithms: ['RS256'] }, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        req.user = decoded;
        next();
    });
}

// Middleware untuk memastikan user memiliki role tertentu
function requireRole(role) {
    return (req, res, next) => {
        const roles = (req.user && req.user.realm_access && req.user.realm_access.roles) || [];
        if (roles.includes(role)) return next();
        return res.status(403).json({ error: 'Akses ditolak: butuh role ' + role });
    };
}

// Endpoint helper untuk frontend saat TEST_MODE (mengembalikan user demo)
app.get('/api/me', (req, res) => {
    if (process.env.TEST_MODE === 'true') {
        return res.json({
            sub: 1,
            preferred_username: 'demo.user',
            realm_access: { roles: ['admin', 'mahasiswa'] },
            token: 'TEST-TOKEN'
        });
    }
    res.status(401).json({ error: 'Not available' });
});

// Health/status check for Keycloak (frontend uses this to decide whether to show SSO)
app.get('/auth/keycloak/status', (req, res) => {
    if (process.env.TEST_MODE === 'true') return res.json({ available: false, testMode: true, message: 'Server running in TEST_MODE - use demo login' });
    if (!KEYCLOAK_URL) return res.json({ available: false, message: 'KEYCLOAK_URL not configured on server' });

    try {
        const parsed = url.parse(KEYCLOAK_URL);
        const lib = parsed.protocol === 'https:' ? https : http;
        const options = { method: 'GET', hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80), path: parsed.path || '/', timeout: 2000 };
        const req2 = lib.request(options, (r) => {
            // consider reachable if responds with 200/302/301
            const ok = [200, 301, 302].includes(r.statusCode);
            res.json({ available: ok, statusCode: r.statusCode });
        });
        req2.on('error', (e) => {
            res.json({ available: false, error: e.message });
        });
        req2.on('timeout', () => { req2.destroy(); res.json({ available: false, error: 'timeout' }); });
        req2.end();
    } catch (e) {
        res.json({ available: false, error: e.message });
    }
});

// Redirect helper that initiates Keycloak login flow (simple redirect)
app.get('/auth/keycloak', (req, res) => {
    if (process.env.TEST_MODE === 'true') return res.json({ available: false, testMode: true, message: 'Server running in TEST_MODE - use /login.html for demo auth' });
    if (!KEYCLOAK_URL) return res.status(500).json({ error: 'KEYCLOAK_URL not configured on server' });
    // Build an authorization endpoint redirect if possible; fallback to redirecting to KEYCLOAK_URL root
    try {
        const redirectUri = req.protocol + '://' + req.get('host') + '/AS-uts.html';
        const base = KEYCLOAK_URL.replace(/\/+$/,'');
        const authUrl = `${base}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/protocol/openid-connect/auth?client_id=${encodeURIComponent(KEYCLOAK_CLIENT)}&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(redirectUri)}`;
        return res.redirect(302, authUrl);
    } catch (e) {
        return res.redirect(302, KEYCLOAK_URL);
    }
});

// Demo register (simpan user ke tabel user) - hanya aktif di TEST_MODE
app.post('/api/register', (req, res) => {
    if (process.env.TEST_MODE !== 'true') return res.status(403).json({ error: 'Not allowed' });
    const { nama, email, role, password } = req.body;
    if (!email || !role || !password) return res.status(400).json({ error: 'Missing fields' });
    db.run('INSERT INTO user (nama, email, role, password) VALUES (?, ?, ?, ?)', [nama || '', email, role, password], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, nama, email, role });
    });
});

// Demo login (cek email+password dan kembalikan token-like response)
app.post('/api/login', (req, res) => {
    if (process.env.TEST_MODE !== 'true') return res.status(403).json({ error: 'Not allowed' });
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
    db.get('SELECT id, nama, email, role, password FROM user WHERE email = ?', [email], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row || row.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
        // kembalikan objek mirip token untuk demo
        return res.json({ sub: row.id, preferred_username: row.nama || row.email, realm_access: { roles: [row.role] }, token: 'TEST-TOKEN-' + row.id });
    });
});

// Endpoint: Get semua buku (dengan optional search)
app.get('/api/buku', verifyKeycloakToken, (req, res) => {
    const search = req.query.search;
    let sql = 'SELECT * FROM buku';
    let params = [];
    if (search) {
        sql += ' WHERE judul LIKE ? OR penulis LIKE ?';
        params = [`%${search}%`, `%${search}%`];
    }
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Endpoint tambah buku (khusus admin)
app.post('/api/buku', verifyKeycloakToken, requireRole('admin'), (req, res) => {
    const { judul, penulis, tahun, stok } = req.body;
    db.run('INSERT INTO buku (judul, penulis, tahun, stok) VALUES (?, ?, ?, ?)', [judul, penulis, tahun, stok], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, judul, penulis, tahun, stok });
    });
});

// Endpoint peminjaman buku
app.post('/api/peminjaman', verifyKeycloakToken, (req, res) => {
    const user_id = req.user.sub;
    const { buku_id } = req.body;
    const tanggal_pinjam = new Date().toISOString();
    db.get('SELECT stok FROM buku WHERE id = ?', [buku_id], (err, buku) => {
        if (err || !buku) return res.status(404).json({ error: 'Buku tidak ditemukan' });
        if (buku.stok < 1) return res.status(400).json({ error: 'Stok buku habis' });
        db.run('INSERT INTO peminjaman (user_id, buku_id, tanggal_pinjam, status) VALUES (?, ?, ?, ?)', [user_id, buku_id, tanggal_pinjam, 'dipinjam'], function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            db.run('UPDATE buku SET stok = stok - 1 WHERE id = ?', [buku_id]);
            res.json({ id: this.lastID, user_id, buku_id, tanggal_pinjam, status: 'dipinjam' });
        });
    });
});

// Endpoint pengembalian buku
app.post('/api/pengembalian', verifyKeycloakToken, (req, res) => {
    const user_id = req.user.sub;
    const { peminjaman_id } = req.body;
    const tanggal_kembali = new Date().toISOString();
    // Ambil data peminjaman terlebih dahulu
    db.get('SELECT * FROM peminjaman WHERE id = ? AND status = ?', [peminjaman_id, 'dipinjam'], (err, pinjam) => {
        if (err || !pinjam) return res.status(404).json({ error: 'Data peminjaman tidak ditemukan' });
        // Jika bukan peminjam, periksa apakah user adalah admin
        if (pinjam.user_id !== user_id) {
            const roles = (req.user && req.user.realm_access && req.user.realm_access.roles) || [];
            if (!roles.includes('admin')) {
                return res.status(403).json({ error: 'Hanya peminjam atau admin yang dapat mengembalikan buku ini' });
            }
        }
        db.run('UPDATE peminjaman SET tanggal_kembali = ?, status = ? WHERE id = ?', [tanggal_kembali, 'dikembalikan', peminjaman_id], function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            db.run('UPDATE buku SET stok = stok + 1 WHERE id = ?', [pinjam.buku_id]);
            res.json({ id: peminjaman_id, status: 'dikembalikan', tanggal_kembali });
        });
    });
});

// Endpoint untuk daftar peminjaman user (frontend)
app.get('/api/peminjaman-user', verifyKeycloakToken, (req, res) => {
    const user_id = req.user.sub;
    db.all(`SELECT p.id, b.judul, p.status FROM peminjaman p JOIN buku b ON p.buku_id = b.id WHERE p.user_id = ?`, [user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Start server (bind hanya ke localhost untuk mencegah eksposur ke web)
const HOST = process.env.BIND_HOST || '127.0.0.1';
const PORT = process.env.PORT || 3001;
// Optional: jika ALLOW_PUBLIC=true, izinkan bind ke 0.0.0.0 supaya bisa diakses dari jaringan
const allowPublic = process.env.ALLOW_PUBLIC === 'true';
const bindHost = allowPublic ? '0.0.0.0' : HOST;

// Serve static files so AS-uts.html dan aset lain dapat diakses
app.use(express.static(__dirname));
app.get('/', (req, res) => res.redirect('/AS-uts.html'));

app.listen(PORT, bindHost, () => {
    console.log(`Server berjalan di http://${bindHost}:${PORT} (public=${allowPublic})`);
});
