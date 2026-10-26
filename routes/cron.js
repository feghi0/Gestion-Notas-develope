const router = require('express').Router();
const { timingSafeEqual } = require('crypto');
const { asegurarCicloAutomatico } = require('../lib/aperturaCiclo');
router.get('/ciclo-lectivo', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const esperado = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
  const recibido = Buffer.from(req.headers.authorization || '');
  if (!process.env.CRON_SECRET || recibido.length !== esperado.length || !timingSafeEqual(recibido, esperado)) return res.status(401).json({ success: false });
  try { res.json({ success: true, ...await asegurarCicloAutomatico() }); }
  catch (err) { console.error('Apertura automática:', err.code); res.status(500).json({ success: false }); }
});
module.exports = router;
