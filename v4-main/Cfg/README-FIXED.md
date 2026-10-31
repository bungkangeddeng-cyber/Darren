# Cfg — catatan versi perbaikan

File `config.json` di folder ini adalah TEMPLATE, bukan config Xray
yang valid untuk langsung dipakai. File itu mengandung marker
template sehingga parser JSON menolaknya. Jangan menyalinnya
langsung ke `/etc/xray/config.json`.

Pakai config yang dihasilkan menu/API di server, atau generate
config Xray yang valid dari template ini sebelum deploy.
