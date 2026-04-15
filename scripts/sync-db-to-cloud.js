#!/usr/bin/env node

/**
 * 同步腳本：本地 MongoDB → 雲端 MongoDB
 * 用途：每小時自動同步本地數據到雲端作為備份
 *
 * 使用方式：
 *   node scripts/sync-db-to-cloud.js
 *
 * 或用 npm script：
 *   npm run db:sync
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// 讀取 .env 檔案
function loadEnv(filePath = '.env') {
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};

  content.split(/\r?\n/).forEach(line => {
    if (!line || line.trim().startsWith('#')) return;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  });

  return env;
}

async function syncToCloud() {
  const envVars = loadEnv();
  const localUri = envVars.MONGODB_URI;
  const cloudUri = envVars.MONGODB_CLOUD_URI;
  const dbName = envVars.MONGODB_DB_NAME;

  if (!localUri || !cloudUri || !dbName) {
    console.error('❌ .env 中缺少必要的 MongoDB 連接資訊');
    console.error('   需要: MONGODB_URI, MONGODB_CLOUD_URI, MONGODB_DB_NAME');
    process.exit(1);
  }

  const localClient = new MongoClient(localUri);
  const cloudClient = new MongoClient(cloudUri);

  try {
    console.log(`\n🔄 開始同步 (${new Date().toISOString()})`);
    console.log('━'.repeat(50));

    // 連接到兩個數據庫
    console.log('🔌 連接本地 MongoDB...');
    await localClient.connect();
    const localDb = localClient.db(dbName);

    console.log('☁️  連接雲端 MongoDB...');
    await cloudClient.connect();
    const cloudDb = cloudClient.db(dbName);

    // 取得本地的所有 collection
    const collections = await localDb.listCollections().toArray();
    console.log(`📦 找到 ${collections.length} 個 Collections\n`);

    let totalSynced = 0;
    let syncedCollections = [];

    // 同步每個 collection
    for (const collection of collections) {
      const collName = collection.name;
      process.stdout.write(`⬆️  同步 ${collName}... `);

      try {
        // 取得本地數據
        const localDocs = await localDb.collection(collName).find({}).toArray();
        const docCount = localDocs.length;

        // 清空雲端 collection
        await cloudDb.collection(collName).deleteMany({});

        // 寫入雲端
        if (docCount > 0) {
          await cloudDb.collection(collName).insertMany(localDocs);
        }

        console.log(`✓ (${docCount} 筆)`);
        syncedCollections.push(collName);
        totalSynced += docCount;

      } catch (err) {
        console.error(`❌ 失敗: ${err.message}`);
      }
    }

    console.log('\n' + '━'.repeat(50));
    console.log(`✅ 同步完成！`);
    console.log(`   Collections: ${syncedCollections.length}/${collections.length}`);
    console.log(`   記錄總數: ${totalSynced}`);
    console.log(`   時間: ${new Date().toISOString()}\n`);

  } catch (err) {
    console.error('\n❌ 同步失敗:', err.message);
    process.exit(1);
  } finally {
    await localClient.close();
    await cloudClient.close();
  }
}

// 如果直接執行此腳本
if (require.main === module) {
  syncToCloud().catch(err => {
    console.error('致命錯誤:', err);
    process.exit(1);
  });
}

module.exports = { syncToCloud };
