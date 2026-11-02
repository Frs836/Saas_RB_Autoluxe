const https = require('https');
const fs = require('fs');

const sqlFile = process.argv[2];
if (!sqlFile) { console.error('Usage: node deploy-sql.js <migration-file>'); process.exit(1); }

const sql = fs.readFileSync(sqlFile, 'utf8');
const env = fs.readFileSync('C:\\Users\\User\\Desktop\\Saas_RB_Autoluxe\\.env.local', 'utf8');
const token = env.match(/SUPABASE_ACCESS_TOKEN=(.+)/)[1].trim();
const body = JSON.stringify({ query: sql });

const req = https.request({
  hostname: 'api.supabase.com',
  path: '/v1/projects/qidtfssldidzvehssevk/database/query',
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✓ Deployed:', sqlFile, '— Status:', res.statusCode);
    } else {
      console.error('✗ Failed:', res.statusCode, data);
      process.exit(1);
    }
  });
});
req.on('error', e => { console.error(e.message); process.exit(1); });
req.write(body); req.end();
