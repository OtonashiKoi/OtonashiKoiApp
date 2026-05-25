#!/usr/bin/env node

/**
 * 同步腳本：雲端 MongoDB → 本地 MongoDB
 * 用途：把雲端 equipmentGame 完整鏡像到本地（會覆蓋本地內容）
 *
 * 使用方式：
 *   node scripts/sync-cloud-to-local.js
 *   npm run db:pull
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');

function loadEnv(filePath = '.env') {
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  content.split(/\r?\n/).forEach(line => {
    if (!line || line.trim().startsWith('#')) return;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  });
  return env;
}

function isLocalUri(uri) {
  return /(?:localhost|127\.0\.0\.1)/i.test(uri);
}

async function syncFromCloud() {
  const envVars = loadEnv();
  const localUri = envVars.MONGODB_URI;
  const cloudUri = envVars.MONGODB_CLOUD_URI;
  const dbName = envVars.MONGODB_DB_NAME;

  if (!localUri || !cloudUri || !dbName) {
    console.error('❌ .env 缺少 MONGODB_URI / MONGODB_CLOUD_URI / MONGODB_DB_NAME');
    process.exit(1);
  }

  if (!isLocalUri(localUri)) {
    console.error('❌ MONGODB_URI 看起來不是本地連線，為了避免誤覆蓋已中止');
    console.error(`   MONGODB_URI=${localUri}`);
    process.exit(1);
  }
  if (isLocalUri(cloudUri)) {
    console.error('❌ MONGODB_CLOUD_URI 看起來是本地連線，方向錯誤');
    process.exit(1);
  }

  const localClient = new MongoClient(localUri);
  const cloudClient = new MongoClient(cloudUri);

  try {
    console.log(`\n🔄 雲端 → 本地 同步開始 (${new Date().toISOString()})`);
    console.log('━'.repeat(50));

    console.log('☁️  連接雲端 MongoDB...');
    await cloudClient.connect();
    const cloudDb = cloudClient.db(dbName);

    console.log('🔌 連接本地 MongoDB...');
    await localClient.connect();
    const localDb = localClient.db(dbName);

    const collections = await cloudDb.listCollections().toArray();
    console.log(`📦 雲端共 ${collections.length} 個 Collections\n`);

    let totalSynced = 0;
    const syncedCollections = [];
    const failedCollections = [];

    for (const collection of collections) {
      const collName = collection.name;
      process.stdout.write(`⬇️  ${collName.padEnd(32)} `);

      try {
        const cloudDocs = await cloudDb.collection(collName).find({}).toArray();
        const docCount = cloudDocs.length;

        await localDb.collection(collName).deleteMany({});

        if (docCount > 0) {
          const BATCH = 1000;
          for (let i = 0; i < cloudDocs.length; i += BATCH) {
            const slice = cloudDocs.slice(i, i + BATCH);
            await localDb.collection(collName).insertMany(slice, { ordered: false });
          }
        }

        console.log(`✓ ${docCount} 筆`);
        syncedCollections.push(collName);
        totalSynced += docCount;
      } catch (err) {
        console.log(`❌ ${err.message}`);
        failedCollections.push({ name: collName, error: err.message });
      }
    }

    console.log('\n' + '━'.repeat(50));
    console.log(`✅ 同步完成`);
    console.log(`   成功 Collections: ${syncedCollections.length}/${collections.length}`);
    console.log(`   記錄總數: ${totalSynced}`);
    if (failedCollections.length > 0) {
      console.log(`   失敗:`);
      for (const f of failedCollections) console.log(`     - ${f.name}: ${f.error}`);
    }
    console.log(`   時間: ${new Date().toISOString()}\n`);
  } catch (err) {
    console.error('\n❌ 同步失敗:', err.message);
    process.exit(1);
  } finally {
    await cloudClient.close();
    await localClient.close();
  }
}

if (require.main === module) {
  syncFromCloud().catch(err => {
    console.error('致命錯誤:', err);
    process.exit(1);
  });
}

module.exports = { syncFromCloud };
