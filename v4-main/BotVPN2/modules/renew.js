const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

async function renewssh(username, exp, limitip, serverId) {
  console.log(`Renewing SSH account for ${username} with expiry ${exp} days, limit IP ${limitip} on server ${serverId}`);
  
  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err) {
        console.error('Error fetching server:', err.message);
        return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');
      }

      if (!server) return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');

      const domain = server.domain;
      const auth = server.auth;
      const param = `:5889/renewssh?user=${username}&exp=${exp}&iplimit=${limitip}&auth=${auth}`;
      const url = `http://${domain}${param}`;
      axios.get(url)
        .then(response => {
          if (response.data.status === "success") {
            const sshData = response.data.data;
            const msg = `
────────────────────
❇️ *RENEW SSH PREMIUM* ❇️
────────────────────
┌───────────────────
│ Username: \`${username}\`
│ Kadaluarsa: \`${sshData.expired}\`
│ Batas IP: \`${sshData.ip_limit}\`
└───────────────────
✅ *Akun berhasil diperbarui* ✨
*Makasih sudah pakai layanan kami*
`;
         
              console.log('SSH account renewed successfully');
              return resolve(msg);
            } else {
              console.log('Error renewing SSH account');
              return resolve(`❌ Gagal: ${response.data.message}`);
            }
          })
        .catch(error => {
          console.error('Error saat memperbarui SSH:', error);
          return resolve('❌ Gagal memperbarui SSH. Silakan coba lagi nanti.');
        });
    });
  });
}
async function renewvmess(username, exp, quota, limitip, serverId) {
    console.log(`Renewing VMess account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip} on server ${serverId}`);
    
    if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
      return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
    }
  
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
        if (err) {
          console.error('Error fetching server:', err.message);
          return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');
        }
  
        if (!server) return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');
  
        const domain = server.domain;
        const auth = server.auth;
        const param = `:5889/renewvmess?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${auth}`;
        const url = `http://${domain}${param}`;
        axios.get(url)
          .then(response => {
            if (response.data.status === "success") {
              const vmessData = response.data.data;
              const msg = `
─────────────────────
❇️ *RENEW VMESS PREMIUM* ❇️
─────────────────────
┌────────────────────
│ Username: \`${username}\`
│ Kadaluarsa: \`${vmessData.expired}\`
│ Kuota: \`${vmessData.quota === '0 GB' ? 'Unlimited' : vmessData.quota}\`
│ Batas IP: \`${vmessData.ip_limit === '0' ? 'Unlimited' : vmessData.ip_limit} IP\`
└────────────────────
✅ *Akun berhasil diperbarui* ✨
*Makasih sudah pakai layanan kami*
  `;
                console.log('VMess account renewed successfully');
                return resolve(msg);
              } else {
                console.log('Error renewing VMess account');
                return resolve(`❌ Gagal: ${response.data.message}`);
              }
            })
          .catch(error => {
            console.error('Error saat memperbarui VMess:', error);
            return resolve('❌ Gagal memperbarui VMess. Silakan coba lagi nanti.');
          });
      });
    });
  }
  async function renewvless(username, exp, quota, limitip, serverId) {
    console.log(`Renewing VLess account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip} on server ${serverId}`);
    
    if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
      return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
    }
  
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
        if (err) {
          console.error('Error fetching server:', err.message);
          return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');
        }
  
        if (!server) return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');
  
        const domain = server.domain;
        const auth = server.auth;
        const param = `:5889/renewvless?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${auth}`;
        const url = `http://${domain}${param}`;
        axios.get(url)
          .then(response => {
            if (response.data.status === "success") {
              const vlessData = response.data.data;
              const msg = `
─────────────────────
❇️ *RENEW VLESS PREMIUM* ❇️
─────────────────────
┌────────────────────
│ Username: \`${username}\`
│ Kadaluarsa: \`${vlessData.expired}\`
│ Kuota: \`${vlessData.quota === '0 GB' ? 'Unlimited' : vlessData.quota}\`
│ Batas IP: \`${vlessData.ip_limit === '0' ? 'Unlimited' : vlessData.ip_limit} IP\`
└────────────────────
✅ *Akun berhasil diperbarui* ✨
*Makasih sudah pakai layanan kami*
  `;
           
                console.log('VLess account renewed successfully');
                return resolve(msg);
              } else {
                console.log('Error renewing VLess account');
                return resolve(`❌ Gagal: ${response.data.message}`);
              }
            })
          .catch(error => {
            console.error('Error saat memperbarui VLess:', error);
            return resolve('❌ Gagal memperbarui VLess. Silakan coba lagi nanti.');
          });
      });
    });
  }
  async function renewtrojan(username, exp, quota, limitip, serverId) {
    console.log(`Renewing Trojan account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip} on server ${serverId}`);
    
    if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
      return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
    }
  
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
        if (err) {
          console.error('Error fetching server:', err.message);
          return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');
        }
  
        if (!server) return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');
  
        const domain = server.domain;
        const auth = server.auth;
        const param = `:5889/renewtrojan?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${auth}`;
        const url = `http://${domain}${param}`;
        axios.get(url)
          .then(response => {
            if (response.data.status === "success") {
              const trojanData = response.data.data;
              const msg = `
─────────────────────
❇️ *RENEW TROJAN PREMIUM* ❇️
─────────────────────
┌────────────────────
│ Username: \`${username}\`
│ Kadaluarsa: \`${trojanData.expired}\`
│ Kuota: \`${trojanData.quota === '0 GB' ? 'Unlimited' : trojanData.quota}\`
│ Batas IP: \`${trojanData.ip_limit === '0' ? 'Unlimited' : trojanData.ip_limit} IP\`
└────────────────────
✅ *Akun berhasil diperbarui* ✨
*Makasih sudah pakai layanan kami*
  `;
           
                console.log('Trojan account renewed successfully');
                return resolve(msg);
              } else {
                console.log('Error renewing Trojan account');
                return resolve(`❌ Gagal: ${response.data.message}`);
              }
            })
          .catch(error => {
            console.error('Error saat memperbarui Trojan:', error);
            return resolve('❌ Gagal memperbarui Trojan. Silakan coba lagi nanti.');
          });
      });
    });
  }
  async function renewshadowsocks(username, exp, quota, limitip, serverId) {
    console.log(`Renewing Shadowsocks account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip} on server ${serverId}`);
    
    if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
      return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
    }
  
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
        if (err) {
          console.error('Error fetching server:', err.message);
          return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');
        }
  
        if (!server) return resolve('❌ Gagal: Server tidak ditemukan. Silakan coba lagi.');
  
        const domain = server.domain;
        const auth = server.auth;
        const param = `:5889/renewshadowsocks?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${auth}`;
        const url = `http://${domain}${param}`;
        axios.get(url)
          .then(response => {
            if (response.data.status === "success") {
              const shadowsocksData = response.data.data;
              const msg = `
─────────────────────
❇️ *RENEW SHDWSK PREMIUM* ❇️
─────────────────────
┌────────────────────
│ Username: \`${username}\`
│ Kadaluarsa: \`${shadowsocksData.expired}\`
│ Kuota: \`${shadowsocksData.quota === '0 GB' ? 'Unlimited' : shadowsocksData.quota}\`
│ Batas IP: \`${shadowsocksData.ip_limit === '0' ? 'Unlimited' : shadowsocksData.ip_limit} IP\`
└────────────────────
✅ *Akun berhasil diperbarui* ✨
*Makasih sudah pakai layanan kami*
  `;
           
                console.log('Shadowsocks account renewed successfully');
                return resolve(msg);
              } else {
                console.log('Error renewing Shadowsocks account');
                return resolve(`❌ Gagal: ${response.data.message}`);
              }
            })
          .catch(error => {
            console.error('Error saat memperbarui Shadowsocks:', error);
            return resolve('❌ Gagal memperbarui Shadowsocks. Silakan coba lagi nanti.');
          });
      });
    });
  }
  
  module.exports = { renewshadowsocks, renewtrojan, renewvless, renewvmess, renewssh };