const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const viewsRoot = path.join(projectRoot, 'views');
const errors = [];

function viewFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return viewFiles(entryPath);
    return entry.name.endsWith('.ejs') ? [entryPath] : [];
  });
}

for (const file of viewFiles(viewsRoot)) {
  const relative = path.relative(viewsRoot, file);
  const normalized = relative.split(path.sep).join('/');
  const content = fs.readFileSync(file, 'utf8');

  if (/picocss|custom\.css/i.test(content)) {
    errors.push(`${normalized}: no debe cargar Pico ni custom.css.`);
  }

  if (!normalized.includes('/partials/') && content.includes('</html>') && !content.includes("partials/head")) {
    errors.push(`${normalized}: debe incluir el parcial compartido partials/head.`);
  }
}

const sharedHead = fs.readFileSync(path.join(viewsRoot, 'partials', 'head.ejs'), 'utf8');
if (!sharedHead.includes('/vendor/tabler/css/tabler.min.css')) {
  errors.push('partials/head.ejs: debe cargar Tabler desde el recurso local.');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('UI verificada: todas las vistas completas usan la base compartida de Tabler.');
