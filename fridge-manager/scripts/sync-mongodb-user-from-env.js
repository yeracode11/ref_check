#!/usr/bin/env node
/**
 * Синхронизация пользователя MongoDB с MONGODB_URI из .env (после restore).
 *   node scripts/sync-mongodb-user-from-env.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const uri = process.env.MONGODB_URI || '';
const localAdmin = 'mongodb://127.0.0.1:27017/admin';

function parseCredentials(connectionUri) {
  try {
    const u = new URL(connectionUri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    if (!u.username) return null;
    const user = decodeURIComponent(u.username);
    const pass = decodeURIComponent(u.password);
    const pathname = u.pathname.replace(/^\//, '') || 'fridge_manager';
    const appDb = pathname.split('/')[0] || 'fridge_manager';
    return { user, pass, appDb };
  } catch {
    return null;
  }
}

async function main() {
  const creds = parseCredentials(uri);
  if (!creds) {
    console.log('[sync-mongo-user] MONGODB_URI без логина — пропуск');
    process.exit(0);
  }

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(localAdmin, { serverSelectionTimeoutMS: 8000 });

  try {
    await client.connect();
    const admin = client.db('admin');
    const { user, pass, appDb } = creds;
    const roles = [
      { role: 'root', db: 'admin' },
      { role: 'readWrite', db: appDb },
    ];

    try {
      await admin.command({ updateUser: user, pwd: pass, roles });
      console.log(`[sync-mongo-user] User updated: ${user}`);
    } catch (e) {
      if (e.codeName === 'UserNotFound' || e.code === 11) {
        await admin.command({ createUser: user, pwd: pass, roles });
        console.log(`[sync-mongo-user] User created: ${user}`);
      } else {
        throw e;
      }
    }

    await client.close();

    const testClient = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await testClient.connect();
    await testClient.db(appDb).command({ ping: 1 });
    await testClient.close();
    console.log('[sync-mongo-user] OK — MONGODB_URI работает');
  } catch (err) {
    console.error('[sync-mongo-user] ERROR:', err.message);
    process.exit(1);
  }
}

main();
