/**
 * TextStation Pro - ユーティリティと共通機能
 * ログ管理、認証、スニペット管理などの共通機能を提供
 */

// 設定
const CONFIG = {
  MAX_LOGS_AGE_DAYS: 90,   // ログの最大保持期間（日数）
  MAX_BACKUPS_AGE_DAYS: 30  // バックアップの最大保持期間（日数）
};

/**
 * スニペット一覧を取得
 */
async function getSnippets(db) {
  try {
    // 個人用スニペット
    const personalSnapshotRef = db.collection('snippets')
      .where('isShared', '==', false)
      .orderBy('createdAt', 'desc');
      
    const personalSnapshot = await personalSnapshotRef.get();
    
    const personal = [];
    const categories = new Set(['未分類']);
    
    personalSnapshot.forEach(doc => {
      const data = doc.data();
      personal.push({
        id: doc.id,
        title: data.title,
        category: data.category || '未分類',
        createdAt: data.createdAt
      });
      
      if (data.category) {
        categories.add(data.category);
      }
    });
    
    // 共有スニペット
    const sharedSnapshotRef = db.collection('snippets')
      .where('isShared', '==', true)
      .orderBy('createdAt', 'desc');
      
    const sharedSnapshot = await sharedSnapshotRef.get();
    
    const shared = [];
    const sharedCategories = new Set(['未分類']);
    
    sharedSnapshot.forEach(doc => {
      const data = doc.data();
      shared.push({
        id: doc.id,
        title: data.title,
        category: data.category || '未分類',
        createdAt: data.createdAt
      });
      
      if (data.category) {
        sharedCategories.add(data.category);
      }
    });
    
    return {
      personal,
      shared,
      categories: Array.from(categories),
      sharedCategories: Array.from(sharedCategories)
    };
  } catch (error) {
    console.error('スニペット取得エラー:', error);
    throw new Error('スニペットの取得中にエラーが発生しました: ' + error.message);
  }
}

/**
 * 指定IDのスニペットを取得
 */
async function getSnippet(db, id, isShared = false) {
  try {
    const snippetRef = db.collection('snippets').doc(id);
    const snippet = await snippetRef.get();
    
    if (!snippet.exists) {
      return null;
    }
    
    const data = snippet.data();
    
    // 共有設定の確認
    if (data.isShared !== !!isShared) {
      return null;
    }
    
    return {
      id: snippet.id,
      title: data.title,
      category: data.category || '未分類',
      content: data.content,
      variables: data.variables || [],
      isShared: data.isShared || false,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    };
  } catch (error) {
    console.error('スニペット取得エラー:', error);
    throw new Error('スニペットの取得中にエラーが発生しました: ' + error.message);
  }
}

/**
 * スニペットを保存
 */
async function saveSnippet(db, snippetData) {
  try {
    const snippetRef = db.collection('snippets').doc();
    
    await snippetRef.set({
      ...snippetData,
      isShared: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    
    return { id: snippetRef.id };
  } catch (error) {
    console.error('スニペット保存エラー:', error);
    throw new Error('スニペットの保存中にエラーが発生しました: ' + error.message);
  }
}

/**
 * スニペットを更新
 */
async function updateSnippet(db, id, snippetData) {
  try {
    const snippetRef = db.collection('snippets').doc(id);
    const snippet = await snippetRef.get();
    
    if (!snippet.exists) {
      throw new Error('スニペットが見つかりません');
    }
    
    // 既存のデータと更新データをマージ
    await snippetRef.update({
      ...snippetData,
      updatedAt: Date.now()
    });
    
    return { success: true };
  } catch (error) {
    console.error('スニペット更新エラー:', error);
    throw new Error('スニペットの更新中にエラーが発生しました: ' + error.message);
  }
}

/**
 * スニペットを削除
 */
async function deleteSnippet(db, id) {
  try {
    const snippetRef = db.collection('snippets').doc(id);
    const snippet = await snippetRef.get();
    
    if (!snippet.exists) {
      throw new Error('スニペットが見つかりません');
    }
    
    // 共有スニペットの場合は削除できない（権限管理の実装が必要）
    const data = snippet.data();
    if (data.isShared) {
      throw new Error('共有スニペットは削除できません');
    }
    
    // スニペットを削除
    await snippetRef.delete();
    
    return { success: true };
  } catch (error) {
    console.error('スニペット削除エラー:', error);
    
    throw new Error('スニペットの削除中にエラーが発生しました: ' + error.message);
  }
}

/**
 * ログ集約データを保存
 */
async function saveLogAggregation(db, logData) {
  try {
    const logRef = db.collection('logs').doc();
    
    await logRef.set({
      ...logData,
      createdAt: Date.now()
    });
    
    return { success: true };
  } catch (error) {
    console.error('ログ保存エラー:', error);
    throw new Error('ログの保存中にエラーが発生しました: ' + error.message);
  }
}

/**
 * 古いログを削除
 */
async function cleanupOldLogs(db) {
  try {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - CONFIG.MAX_LOGS_AGE_DAYS);
    
    const oldLogsRef = db.collection('logs')
      .where('timestamp', '<', thresholdDate.getTime());
    
    const snapshot = await oldLogsRef.get();
    
    // バッチ削除（Firestoreの制限により一度に最大500件まで）
    const batch = db.batch();
    let count = 0;
    
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
      count++;
    });
    
    if (count > 0) {
      await batch.commit();
      console.log(`${count}件の古いログを削除しました`);
    }
    
    return { success: true, count };
  } catch (error) {
    console.error('ログ削除エラー:', error);
    throw new Error('古いログの削除中にエラーが発生しました: ' + error.message);
  }
}

/**
 * バックアップを保存
 */
async function saveBackup(db, backupData) {
  try {
    const backupRef = db.collection('backups').doc();
    
    await backupRef.set({
      ...backupData,
      createdAt: Date.now()
    });
    
    return { success: true, id: backupRef.id };
  } catch (error) {
    console.error('バックアップ保存エラー:', error);
    throw new Error('バックアップの保存中にエラーが発生しました: ' + error.message);
  }
}

/**
 * 古いバックアップを削除
 */
async function cleanupOldBackups(db) {
  try {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - CONFIG.MAX_BACKUPS_AGE_DAYS);
    
    const oldBackupsRef = db.collection('backups')
      .where('timestamp', '<', thresholdDate.getTime());
    
    const snapshot = await oldBackupsRef.get();
    
    // バッチ削除
    const batch = db.batch();
    let count = 0;
    
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
      count++;
    });
    
    if (count > 0) {
      await batch.commit();
      console.log(`${count}件の古いバックアップを削除しました`);
    }
    
    return { success: true, count };
  } catch (error) {
    console.error('バックアップ削除エラー:', error);
    throw new Error('古いバックアップの削除中にエラーが発生しました: ' + error.message);
  }
}

/**
 * バックアップ一覧を取得
 */
async function getBackups(db) {
  try {
    const backupsRef = db.collection('backups')
      .orderBy('timestamp', 'desc')
      .limit(30); // 最新30件を取得
    
    const snapshot = await backupsRef.get();
    
    const backups = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      backups.push({
        id: doc.id,
        date: data.date,
        timestamp: data.timestamp,
        user: data.user
      });
    });
    
    return backups;
  } catch (error) {
    console.error('バックアップ一覧取得エラー:', error);
    throw new Error('バックアップ一覧の取得中にエラーが発生しました: ' + error.message);
  }
}

/**
 * 指定IDのバックアップを取得
 */
async function getBackup(db, id) {
  try {
    const backupRef = db.collection('backups').doc(id);
    const backup = await backupRef.get();
    
    if (!backup.exists) {
      return null;
    }
    
    return backup.data();
  } catch (error) {
    console.error('バックアップ取得エラー:', error);
    throw new Error('バックアップの取得中にエラーが発生しました: ' + error.message);
  }
}

/**
 * 日時からYYYY-MM-DD形式の文字列を取得
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * エラーレスポンスを生成
 */
function createErrorResponse(message, statusCode = 500) {
  return {
    error: true,
    message,
    statusCode
  };
}

module.exports = {
  getSnippets,
  getSnippet,
  saveSnippet,
  updateSnippet,
  deleteSnippet,
  saveLogAggregation,
  cleanupOldLogs,
  saveBackup,
  cleanupOldBackups,
  getBackups,
  getBackup,
  formatDate,
  createErrorResponse
};