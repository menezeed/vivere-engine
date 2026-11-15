const { createClient } = require('@supabase/supabase-js');

const ID = 'e36d3553-2f56-4d42-8fce-fb47c578d69f';
const URL = 'https://jvtcgomwbfojsttepcfc.supabase.co';

if (
  process.env.SUPABASE_URL !== URL ||
  !process.env.SUPABASE_SERVICE_KEY ||
  process.env.VIVERE_ENV !== 'staging'
) {
  console.log('RECUSA: staging ou chave nao configurados');
  process.exit(1);
}

const c = createClient(URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

(async () => {
  const a = await c.from('activities')
    .select('id,recurrence_time,start_date')
    .eq('id', ID);

  if (a.error || a.data?.length !== 1) {
    console.log('RECUSA: registro nao encontrado', a.error?.message);
    process.exit(1);
  }

  const antes = a.data[0];
  console.log('ANTES:', JSON.stringify(antes));

  if (!String(antes.start_date).startsWith('2026-12-31')) {
    console.log('RECUSA: data inesperada');
    process.exit(1);
  }

  if (antes.recurrence_time !== null) {
    console.log('RECUSA: horario ja preenchido');
    process.exit(1);
  }

  const r = await c.from('activities')
    .update({ recurrence_time: '06:00' })
    .eq('id', ID)
    .is('recurrence_time', null)
    .select('id,recurrence_time,start_date');

  if (r.error) {
    console.log('ERRO:', r.error.message);
    process.exit(1);
  }

  console.log('LINHAS_ALTERADAS=' + r.data.length);
  console.log('DEPOIS:', JSON.stringify(r.data[0]));

  if (
    r.data.length === 1 &&
    r.data[0].recurrence_time === '06:00' &&
    r.data[0].start_date === antes.start_date
  ) {
    console.log('OK: hora 06:00, data inalterada');
  } else {
    console.log('NAO OK: verificar resultado');
    process.exitCode = 1;
  }
})().catch(e => {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
});