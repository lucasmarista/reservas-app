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

// cria/atualiza schema
async function ensureSchema() {
  await pool.query(`
    create table if not exists totals (
      id integer primary key default 1,
      -- novos campos
      tablets_internet integer not null default 25,
      tablets_geral    integer not null default 222,
      notebooks        integer not null default 150,
      lab_tec          integer not null default 1,
      sala_maker       integer not null default 1
    );
  `);

  // compat: se a tabela já existia sem as colunas novas
  await pool.query(`alter table totals add column if not exists tablets_internet integer not null default 25;`);
  await pool.query(`alter table totals add column if not exists tablets_geral    integer not null default 222;`);
  await pool.query(`alter table totals add column if not exists notebooks        integer not null default 150;`);
  await pool.query(`alter table totals add column if not exists lab_tec          integer not null default 1;`);
  await pool.query(`alter table totals add column if not exists sala_maker       integer not null default 1;`);

  await pool.query(`
    create table if not exists reservations (
      id text primary key,
      date date not null,
      period text not null,         -- 'manha' | 'tarde'
      segment text not null,        -- 'Infantil' | 'Fundamental 1' | ...
      resource text not null,       -- 'ipads_internet' | 'ipads_geral' | 'notebooks' | 'lab_tec' | 'sala_maker'
      qty integer not null,
      teacher text not null,
      turma text not null,
      notes text,
      slots jsonb not null
    );
  `);

  // garante uma linha em totals
  const r = await pool.query(`select count(*)::int as c from totals where id=1`);
  if (r.rows[0].c === 0) {
    await pool.query(`
      insert into totals(id, tablets_internet, tablets_geral, notebooks, lab_tec, sala_maker)
      values (1, 25, 222, 150, 1, 1)
    `);
  }
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api', async (req, res) => {
  try {
    const payload = JSON.parse(req.body.data || '{}');
    const act = payload.action;

    if (act === 'getTotals') {
      const r = await pool.query(`
        select tablets_internet, tablets_geral, notebooks, lab_tec, sala_maker
        from totals where id=1
      `);
      return res.json({ ok: true, totals: r.rows[0] });
    }

    if (act === 'setTotals') {
      const t = payload.tot || {};
      const vals = {
        tablets_internet: Number.isFinite(+t.tablets_internet) ? +t.tablets_internet : 25,
        tablets_geral:    Number.isFinite(+t.tablets_geral)    ? +t.tablets_geral    : 222,
        notebooks:        Number.isFinite(+t.notebooks)        ? +t.notebooks        : 150,
        lab_tec:          Number.isFinite(+t.lab_tec)          ? +t.lab_tec          : 1,
        sala_maker:       Number.isFinite(+t.sala_maker)       ? +t.sala_maker       : 1
      };
      await pool.query(`
        insert into totals (id, tablets_internet, tablets_geral, notebooks, lab_tec, sala_maker)
        values (1, $1,$2,$3,$4,$5)
        on conflict (id) do update set
          tablets_internet = excluded.tablets_internet,
          tablets_geral    = excluded.tablets_geral,
          notebooks        = excluded.notebooks,
          lab_tec          = excluded.lab_tec,
          sala_maker       = excluded.sala_maker
      `,[vals.tablets_internet, vals.tablets_geral, vals.notebooks, vals.lab_tec, vals.sala_maker]);
      return res.json({ ok: true, totals: vals });
    }

    if (act === 'list') {
      const r = await pool.query(`
        select id, to_char(date,'YYYY-MM-DD') as date, period, segment, resource, qty, teacher, turma, notes, slots
        from reservations
        order by date asc, period asc
      `);
      return res.json({ ok: true, items: r.rows });
    }

    if (act === 'save') {
      const rec = payload.rec || {};
      const id = 'r' + Math.random().toString(36).slice(2);
      await pool.query(`
        insert into reservations
        (id, date, period, segment, resource, qty, teacher, turma, notes, slots)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        id,
        rec.date, rec.period, rec.segment, rec.resource,
        +rec.qty, rec.teacher || '', rec.turma || '', rec.notes || null,
        JSON.stringify(rec.slots || [])
      ]);
      return res.json({ ok: true, id });
    }

    if (act === 'delete') {
      // valida a senha admin no front; aqui só apaga
      const id = String(payload.id || '');
      const r = await pool.query(`delete from reservations where id=$1`, [id]);
      return res.json({ ok: true, deleted: r.rowCount });
    }

    if (act === 'import') {
      const d = payload.data || {};
      if (d.totals) {
        const t = d.totals;
        await pool.query(`
          insert into totals (id, tablets_internet, tablets_geral, notebooks, lab_tec, sala_maker)
          values (1, $1,$2,$3,$4,$5)
          on conflict (id) do update set
            tablets_internet = excluded.tablets_internet,
            tablets_geral    = excluded.tablets_geral,
            notebooks        = excluded.notebooks,
            lab_tec          = excluded.lab_tec,
            sala_maker       = excluded.sala_maker
        `, [
          +t.tablets_internet || 25,
          +t.tablets_geral    || 222,
          +t.notebooks        || 150,
          +t.lab_tec          || 1,
          +t.sala_maker       || 1
        ]);
      }
      if (Array.isArray(d.reservations)) {
        await pool.query('delete from reservations');
        for (const r of d.reservations) {
          const id = r.id || ('r' + Math.random().toString(36).slice(2));
          await pool.query(`
            insert into reservations
            (id, date, period, segment, resource, qty, teacher, turma, notes, slots)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `, [
            id, r.date, r.period, r.segment, r.resource,
            +r.qty, r.teacher || '', r.turma || '', r.notes || null,
            JSON.stringify(r.slots || [])
          ]);
        }
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({ ok:false, error:'Ação inválida' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

ensureSchema()
  .then(() => app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`)))
  .catch(err => { console.error('Erro schema:', err); process.exit(1); });
