// server.js
const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Defaults de capacidade
const DEFAULT_TOTALS = {
  ipads_internet: 25,
  ipads_geral: 222,
  notebooks: 150,
  lab_tec: 1,
  sala_maker: 1
};

async function ensureSchema() {
  // Tabela de totais
  await pool.query(`
    create table if not exists totals (
      id integer primary key default 1,
      ipads_internet integer,
      ipads_geral integer,
      notebooks integer,
      lab_tec integer,
      sala_maker integer
    );
  `);
  // Garante colunas (idempotente)
  await pool.query(`alter table totals add column if not exists ipads_internet integer;`);
  await pool.query(`alter table totals add column if not exists ipads_geral integer;`);
  await pool.query(`alter table totals add column if not exists notebooks integer;`);
  await pool.query(`alter table totals add column if not exists lab_tec integer;`);
  await pool.query(`alter table totals add column if not exists sala_maker integer;`);

  // Tabela de reservas
  await pool.query(`
    create table if not exists reservations (
      id text primary key,
      date date not null,
      period text not null,
      segment text not null,
      resource text not null,
      qty integer not null,
      teacher text not null,
      turma text not null,
      notes text,
      slots jsonb not null
    );
  `);

  // Semeia defaults se necessário
  const r = await pool.query(`select count(*)::int as c from totals where id=1`);
  if (r.rows[0].c === 0) {
    await pool.query(
      `insert into totals(id, ipads_internet, ipads_geral, notebooks, lab_tec, sala_maker)
       values (1, $1, $2, $3, $4, $5)`,
      [
        DEFAULT_TOTALS.ipads_internet,
        DEFAULT_TOTALS.ipads_geral,
        DEFAULT_TOTALS.notebooks,
        DEFAULT_TOTALS.lab_tec,
        DEFAULT_TOTALS.sala_maker
      ]
    );
  } else {
    // Preenche nulos que possam ter ficado ao evoluir o schema
    await pool.query(
      `update totals set
        ipads_internet = coalesce(ipads_internet, $1),
        ipads_geral    = coalesce(ipads_geral,    $2),
        notebooks      = coalesce(notebooks,      $3),
        lab_tec        = coalesce(lab_tec,        $4),
        sala_maker     = coalesce(sala_maker,     $5)
       where id=1`,
      [
        DEFAULT_TOTALS.ipads_internet,
        DEFAULT_TOTALS.ipads_geral,
        DEFAULT_TOTALS.notebooks,
        DEFAULT_TOTALS.lab_tec,
        DEFAULT_TOTALS.sala_maker
      ]
    );
  }
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
async function readTotals() {
  const r = await pool.query(
    `select ipads_internet, ipads_geral, notebooks, lab_tec, sala_maker from totals where id=1`
  );
  const t = r.rows[0] || {};
  return {
    ipads_internet: t.ipads_internet ?? DEFAULT_TOTALS.ipads_internet,
    ipads_geral: t.ipads_geral ?? DEFAULT_TOTALS.ipads_geral,
    notebooks: t.notebooks ?? DEFAULT_TOTALS.notebooks,
    lab_tec: t.lab_tec ?? DEFAULT_TOTALS.lab_tec,
    sala_maker: t.sala_maker ?? DEFAULT_TOTALS.sala_maker
  };
}

async function writeTotals(partial) {
  const cur = await readTotals();
  const next = {
    ipads_internet: Number.isFinite(+partial.ipads_internet) ? +partial.ipads_internet : cur.ipads_internet,
    ipads_geral: Number.isFinite(+partial.ipads_geral) ? +partial.ipads_geral : cur.ipads_geral,
    notebooks: Number.isFinite(+partial.notebooks) ? +partial.notebooks : cur.notebooks,
    lab_tec: Number.isFinite(+partial.lab_tec) ? +partial.lab_tec : cur.lab_tec,
    sala_maker: Number.isFinite(+partial.sala_maker) ? +partial.sala_maker : cur.sala_maker
  };

  await pool.query(
    `insert into totals (id, ipads_internet, ipads_geral, notebooks, lab_tec, sala_maker)
     values (1, $1, $2, $3, $4, $5)
     on conflict (id) do update set
       ipads_internet = excluded.ipads_internet,
       ipads_geral    = excluded.ipads_geral,
       notebooks      = excluded.notebooks,
       lab_tec        = excluded.lab_tec,
       sala_maker     = excluded.sala_maker`,
    [next.ipads_internet, next.ipads_geral, next.notebooks, next.lab_tec, next.sala_maker]
  );
  return next;
}

// API
app.post('/api', async (req, res) => {
  try {
    const payload = JSON.parse(req.body.data || '{}');
    const action = payload.action;

    if (action === 'getTotals') {
      const totals = await readTotals();
      return res.json({ ok: true, totals });
    }

    if (action === 'setTotals') {
      const next = await writeTotals(payload.tot || {});
      return res.json({ ok: true, totals: next });
    }

    if (action === 'list') {
      const r = await pool.query(`
        select id, to_char(date,'YYYY-MM-DD') as date, period, segment, resource, qty, teacher, turma, notes, slots
        from reservations
        order by date asc, period asc
      `);
      return res.json({ ok: true, items: r.rows });
    }

    if (action === 'save') {
      const rec = payload.rec || {};
      const id = 'r' + Math.random().toString(36).slice(2);
      await pool.query(`
        insert into reservations
        (id, date, period, segment, resource, qty, teacher, turma, notes, slots)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        id,
        rec.date, rec.period, rec.segment, rec.resource,
        +rec.qty, rec.teacher || '', rec.turma || '', rec.notes || null,
        JSON.stringify(rec.slots || [])
      ]);
      return res.json({ ok: true, id });
    }

    if (action === 'delete') {
      const id = String(payload.id || '');
      const r = await pool.query(`delete from reservations where id=$1`, [id]);
      return res.json({ ok: true, deleted: r.rowCount });
    }

    if (action === 'import') {
      const d = payload.data || {};
      if (d.totals) {
        await writeTotals(d.totals);
      }
      if (Array.isArray(d.reservations)) {
        await pool.query('delete from reservations');
        for (const r of d.reservations) {
          const id = r.id || ('r' + Math.random().toString(36).slice(2));
          await pool.query(`
            insert into reservations
            (id, date, period, segment, resource, qty, teacher, turma, notes, slots)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `, [
            id,
            r.date, r.period, r.segment, r.resource,
            +r.qty, r.teacher || '', r.turma || '', r.notes || null,
            JSON.stringify(r.slots || [])
          ]);
        }
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Ação inválida' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

ensureSchema()
  .then(() => app.listen(PORT, () => console.log(`✅ Servidor em http://localhost:${PORT}`)))
  .catch(err => { console.error('Erro ao iniciar esquema:', err); process.exit(1); });
