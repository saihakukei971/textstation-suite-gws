/**
 * TextStation Pro - Node.js APIサーバーメイン
 * Express.jsを使用したAPIエンドポイントの定義
 */

const express = require('express');
const cors = require('cors');
const { json, urlencoded } = require('body-parser');
const admin = require('firebase-admin');
const textProcessor = require('./text-processor');
const exportModule = require('./export');
const utils = require('./utils');

// Firebase初期化
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
  })
});

const db = admin.firestore();

// Expressアプリケーション初期化
const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェア設定
app.use(cors());
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

// API認証ミドルウェア
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['api-key'];
  
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: '認証エラー: 無効なAPIキー' });
  }
  
  next();
};

// すべてのルートに認証を適用
app.use(authenticateApiKey);

// エラーハンドリングミドルウェア
const errorHandler = (err, req, res, next) => {
  console.error('APIエラー:', err);
  res.status(500).json({ error: err.message || 'サーバーエラーが発生しました' });
};

// 接続テストエンドポイント
app.post('/api/test-connection', (req, res) => {
  res.json({ success: true, message: 'APIサーバーに正常に接続されました' });
});

// テキスト分析エンドポイント
app.post('/api/analyze', async (req, res, next) => {
  try {
    const { text, mediaType, detailedAnalysis } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: '分析するテキストが指定されていません' });
    }
    
    // メディア種別に応じたルールを取得
    const mediaRules = await textProcessor.getMediaRules(db, mediaType);
    
    // テキスト分析を実行
    const analysisResult = await textProcessor.analyzeText(text, mediaRules, detailedAnalysis);
    
    res.json(analysisResult);
  } catch (error) {
    next(error);
  }
});

// Google Drive検索エンドポイント
app.post('/api/search', async (req, res, next) => {
  try {
    const { keyword, fileTypes, period } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ error: '検索キーワードが指定されていません' });
    }
    
    // Google Drive検索を実行
    const searchResults = await textProcessor.searchDrive(keyword, fileTypes, period);
    
    res.json(searchResults);
  } catch (error) {
    next(error);
  }
});

// PDF出力エンドポイント
app.post('/api/export-pdf', async (req, res, next) => {
  try {
    const { text, results, options } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: '出力するテキストが指定されていません' });
    }
    
    // PDF生成を実行
    const exportResult = await exportModule.generatePDF(text, results, options);
    
    res.json(exportResult);
  } catch (error) {
    next(error);
  }
});

// スニペット管理エンドポイント
app.post('/api/get-snippets', async (req, res, next) => {
  try {
    const snippets = await utils.getSnippets(db);
    res.json(snippets);
  } catch (error) {
    next(error);
  }
});

app.post('/api/get-snippet', async (req, res, next) => {
  try {
    const { id, isShared } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'スニペットIDが指定されていません' });
    }
    
    const snippet = await utils.getSnippet(db, id, isShared);
    
    if (!snippet) {
      return res.status(404).json({ error: 'スニペットが見つかりません' });
    }
    
    res.json(snippet);
  } catch (error) {
    next(error);
  }
});


app.post('/api/save-snippet', async (req, res, next) => {
  try {
    const { title, category, content, variables } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'タイトルと内容は必須です' });
    }
    
    // スニペットを保存
    const result = await utils.saveSnippet(db, {
      title,
      category: category || '未分類',
      content,
      variables: variables || [],
      createdAt: new Date().getTime()
    });
    
    res.json({ success: true, id: result.id });
  } catch (error) {
    next(error);
  }
});

app.post('/api/update-snippet', async (req, res, next) => {
  try {
    const { id, title, category, content, variables } = req.body;
    
    if (!id || !title || !content) {
      return res.status(400).json({ error: 'IDとタイトルと内容は必須です' });
    }
    
    // スニペットを更新
    await utils.updateSnippet(db, id, {
      title,
      category: category || '未分類',
      content,
      variables: variables || [],
      updatedAt: new Date().getTime()
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/delete-snippet', async (req, res, next) => {
  try {
    const { id } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'スニペットIDが指定されていません' });
    }
    
    // スニペットを削除
    await utils.deleteSnippet(db, id);
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ログ集約エンドポイント
app.post('/api/aggregate-logs', async (req, res, next) => {
  try {
    const { timestamp, week, logs, errors, user } = req.body;
    
    // ログをFirestoreに保存
    await utils.saveLogAggregation(db, {
      timestamp,
      week,
      logs: logs || [],
      errors: errors || [],
      user
    });
    
    // 古いログを削除
    await utils.cleanupOldLogs(db);
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// バックアップエンドポイント
app.post('/api/create-backup', async (req, res, next) => {
  try {
    const { timestamp, date, text, results, user } = req.body;
    
    // バックアップをFirestoreに保存
    await utils.saveBackup(db, {
      timestamp,
      date,
      text,
      results,
      user
    });
    
    // 古いバックアップを削除
    await utils.cleanupOldBackups(db);
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// バックアップ一覧取得エンドポイント
app.post('/api/get-backups', async (req, res, next) => {
  try {
    const backups = await utils.getBackups(db);
    res.json(backups);
  } catch (error) {
    next(error);
  }
});

// バックアップ復元エンドポイント
app.post('/api/restore-backup', async (req, res, next) => {
  try {
    const { id } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'バックアップIDが指定されていません' });
    }
    
    const backup = await utils.getBackup(db, id);
    
    if (!backup) {
      return res.status(404).json({ error: 'バックアップが見つかりません' });
    }
    
    res.json(backup);
  } catch (error) {
    next(error);
  }
});

// エラーハンドリングミドルウェアを適用
app.use(errorHandler);

// サーバー起動
app.listen(PORT, () => {
  console.log(`TextStation API サーバーが起動しました。ポート: ${PORT}`);
});

module.exports = app;