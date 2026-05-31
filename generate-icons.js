const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function createIcon(size, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, size, size);

  // White "A" text
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.floor(size * 0.67)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A', size / 2, size / 2 + size * 0.03);

  // Save to file
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, 'public', filename), buffer);
  console.log(`Created ${filename}`);
}

// Generate all icons
createIcon(180, 'icon-180.png');
createIcon(192, 'icon-192.png');
createIcon(512, 'icon-512.png');

console.log('All icons generated successfully!');
