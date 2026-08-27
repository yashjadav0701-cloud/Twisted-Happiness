const fs = require('fs');
const path = require('path');

// Generate a unique version based on current date & time (e.g., 202608271245)
const newVersion = Date.now().toString(36); 

const filesToUpdate = [
  path.join(__dirname, 'admin.html'),
  path.join(__dirname, 'index.html'),
  path.join(__dirname, 'app.js'),
  path.join(__dirname, 'api', 'share.mjs')
];

filesToUpdate.forEach(filePath => {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace any existing ?v=... with the new version string
    content = content.replace(/\?v=[0-9a-zA-Z._-]+/g, `?v=${newVersion}`);
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated version in: ${path.basename(filePath)} to ?v=${newVersion}`);
  }
});