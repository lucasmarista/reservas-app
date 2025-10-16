const path = require('path');
const fs = require('fs');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Persistência: local usa ./data ; hospedagem pode usar DATA_DIR=/home/data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'reservas.json');

function ensureData(){
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive:true});
  if (!fs.existsSync(DATA_FILE)){
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      totals: { tablets: 247, notebooks: 150 },
      reservations: []
    }, null, 2));
  }
}
ensureData();

function loadDB(){ return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function saveDB(db){ fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

app.use(express.urlencoded({ extended: true })); // para application/x-www-form-urlencoded
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API estilo simples: POST /api com body: data="<json-string>"
app.post('/api', (req, res) => {
  try{
    const payload = JSON.parse(req.body.data || '{}');
    const action = payload.action;
    const db = loadDB();

    if (action === 'list')       return res.json({ ok:true, items: db.reservations });
    if (action === 'getTotals')  return res.json({ ok:true, totals: db.totals });

    if (action === 'setTotals'){
      const t = payload.tot || {};
      db.totals.tablets   = Number.isFinite(+t.tablets)   ? +t.tablets   : db.totals.tablets;
      db.totals.notebooks = Number.isFinite(+t.notebooks) ? +t.notebooks : db.totals.notebooks;
      saveDB(db);
      return res.json({ ok:true, totals: db.totals });
    }

    if (action === 'save'){
      const r = payload.rec || {};
      r.id = 'r' + Math.random().toString(36).slice(2);
      db.reservations.push(r);
      saveDB(db);
      return res.json({ ok:true, id: r.id });
    }

    if (action === 'delete'){
      const id = String(payload.id || '');
      const before = db.reservations.length;
      db.reservations = db.reservations.filter(x => String(x.id) !== id);
      saveDB(db);
      return res.json({ ok:true, deleted: before - db.reservations.length });
    }

    if (action === 'import'){
      const d = payload.data || {};
      if (d.totals) db.totals = d.totals;
      if (Array.isArray(d.reservations)) db.reservations = d.reservations;
      saveDB(db);
      return res.json({ ok:true });
    }

    return res.status(400).json({ ok:false, error: 'Ação inválida' });
  }catch(e){
    console.error(e);
    return res.status(500).json({ ok:false, error: String(e) });
  }
});

app.listen(PORT, () => console.log(`✅ Servidor em http://localhost:${PORT}`));
