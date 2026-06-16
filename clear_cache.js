const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'data.json');
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  
  // Clear the cover cache
  data.bookCoverCache = {};
  
  // Save back to data.json
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log('✅ 封面缓存清理成功！请重启 Obsidian 查看效果。');
} catch (error) {
  console.error('❌ 清理失败：', error.message);
}
