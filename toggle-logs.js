#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'assets');
const mode = process.argv[2];

if (!mode || !['mute', 'unmute'].includes(mode)) {
  console.log('Usage: node toggle-logs.js <mute|unmute>');
  process.exit(1);
}

const files = fs.readdirSync(assetsDir).filter(f => f.endsWith('.script.js'));

files.forEach(file => {
  const filePath = path.join(assetsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  if (mode === 'mute') {
    // Replace console.log with //console.log, but not if already commented
    content = content.replace(/(?<!\/\/)console\.log/g, '//console.log');
  } else {
    // Replace //console.log with console.log
    content = content.replace(/\/\/console\.log/g, 'console.log');
  }
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Processed: ${file}`);
});

console.log(`Done. ${mode === 'mute' ? 'Muted' : 'Unmuted'} console.log in ${files.length} files.`);

