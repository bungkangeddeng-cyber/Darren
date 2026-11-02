// Tes vpn-api 5890 TANPA Telegram: create SSH + VLess, lalu delete bersih.
// Auth dibaca dari process.env (diisi admin server dari /etc/vpn-api/auth.env
// saat menjalankan tes, TIDAK ditulis di file ini / .env).
// Jalankan: VPN_API_AUTH=... VPN_DOMAIN=vpn.outletku.ai.id node test/test-api.js
process.env.VPN_API_BASE = process.env.VPN_API_BASE || 'http://127.0.0.1:5890';
const fs = require('fs');
const vpn = require('../src/vpnapi');
const config = require('../src/config');
(async () => {
  if (!process.env.VPN_API_AUTH) { console.error('FAIL: VPN_API_AUTH kosong di env tes.'); process.exit(2); }
  // vpnapi membaca config saat require; pastikan auth dari env tes dipakai:
  config.vpn.apiAuth = process.env.VPN_API_AUTH;
  config.vpn.domain = process.env.VPN_DOMAIN || config.vpn.domain;
  config.vpnCreateEnabled = Boolean(config.vpn.domain && config.vpn.apiAuth);
  const before = fs.existsSync('/etc/xray/config.json') ? fs.readFileSync('/etc/xray/config.json', 'utf8') : '';
  const sshUser = 'tstssh1', vleUser = 'tstvle1';
  console.log('create SSH', sshUser);
  const ssh = await vpn.createAccount('ssh', sshUser, 1);
  console.log('SSH result:', ssh.success ? 'OK' : 'FAIL', ssh.success ? ssh.expiry : ssh.message);
  console.log('create VLess', vleUser);
  const vle = await vpn.createAccount('vless', vleUser, 1);
  console.log('VLess result:', vle.success ? 'OK' : 'FAIL', vle.success ? (vle.link || '').slice(0, 80) : vle.message);
  console.log('delete SSH');
  const delS = await vpn.deleteAccount('ssh', sshUser);
  console.log('delete SSH:', delS.success ? 'OK' : 'FAIL', delS.message);
  console.log('delete VLess');
  const delV = await vpn.deleteAccount('vless', vleUser);
  console.log('delete VLess:', delV.success ? 'OK' : 'FAIL', delV.message);
  await new Promise(r => setTimeout(r, 7000)); // tunggu restart Xray terjadwal (5 detik)
  const after = fs.existsSync('/etc/xray/config.json') ? fs.readFileSync('/etc/xray/config.json', 'utf8') : '';
  const same = before === after;
  console.log('config Xray kembali identik:', same ? 'YA' : 'TIDAK (cek diff manual)');
  if (!same) { fs.writeFileSync('/tmp/test-api-before.txt', before); fs.writeFileSync('/tmp/test-api-after.txt', after); }
  if (!ssh.success || !vle.success || !delS.success || !delV.success) { console.log('HASIL: GAGAL sebagian'); process.exit(1); }
  console.log('HASIL: LULUS (akun tes dihapus, config ' + (same ? 'identik' : 'BERBEDA — lihat /tmp/test-api-*.txt') + ')');
})();
