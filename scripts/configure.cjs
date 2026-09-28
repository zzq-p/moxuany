const fs=require('fs'),crypto=require('crypto');
if(!fs.existsSync('.env'))fs.writeFileSync('.env',`MYSQL_ROOT_PASSWORD=${crypto.randomBytes(24).toString('hex')}\nMYSQL_PASSWORD=${crypto.randomBytes(24).toString('hex')}\nTOKEN_SECRET=${crypto.randomBytes(32).toString('hex')}\n`);
console.log('Local .env ready; existing settings preserved.');
