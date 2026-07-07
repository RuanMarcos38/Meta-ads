import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const required = [
  'index.html',
  'config.js',
  '.htaccess',
  'assets/api.js',
  'assets/styles.css',
  'assets/app.js'
];

for (const file of required) {
  await access(new URL(`../${file}`, import.meta.url), constants.R_OK);
}

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
if (!html.includes('assets/app.js') || !html.includes('assets/api.js') || !html.includes('config.js')) {
  throw new Error('index.html precisa carregar config.js, assets/api.js e assets/app.js');
}

const config = await readFile(new URL('../config.js', import.meta.url), 'utf8');
if (!config.includes('window.APP_CONFIG')) {
  throw new Error('config.js precisa definir window.APP_CONFIG');
}

console.log('Frontend estatico validado.');
