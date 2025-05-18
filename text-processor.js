/**
 * TextStation Pro - テキスト分析と検索機能
 * テキスト分析と検索機能の中核となるロジックを提供
 */

const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// Google認証クライアント
let jwtClient = null;

/**
 * Google認証クライアントを初期化
 */
function getAuthClient() {
  if (jwtClient) return jwtClient;
  
  jwtClient = new JWT({
    email: process.env.FIREBASE_CLIENT_EMAIL,
    key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  
  return jwtClient;
}

/**
 * メディア種別に応じたルールをFirestoreから取得
 */
async function getMediaRules(db, mediaType) {
  try {
    const rulesRef = db.collection('styleRules');
    let query = rulesRef.where('isActive', '==', true);
    
    if (mediaType && mediaType !== '一般') {
      query = query.where('mediaTypes', 'array-contains', mediaType);
    }
    
    const snapshot = await query.get();
    
    const rules = {
      ambiguousPhrases: [],
      repetitivePatterns: [],
      mediaSpecificRules: []
    };
    
    snapshot.forEach(doc => {
      const data = doc.data();
      
      if (data.type === 'ambiguousPhrase') {
        rules.ambiguousPhrases.push({
          text: data.text,
          suggestion: data.suggestion
        });
      } else if (data.type === 'repetitivePattern') {
        rules.repetitivePatterns.push({
          pattern: data.pattern,
          suggestion: data.suggestion
        });
      } else if (data.type === 'mediaSpecific') {
        rules.mediaSpecificRules.push({
          pattern: data.pattern,
          description: data.description,
          mediaType: data.mediaType
        });
      }
    });
    
    return rules;
  } catch (error) {
    console.error('ルール取得エラー:', error);
    return {
      ambiguousPhrases: [],
      repetitivePatterns: [],
      mediaSpecificRules: []
    };
  }
}

/**
 * テキスト分析を実行
 */
async function analyzeText(text, mediaRules, detailedAnalysis) {
  try {
    // 結果オブジェクト
    const result = {
      mediaScore: 0,
      ambiguousPhrases: [],
      repetitiveEndings: [],
      mediaSpecificIssues: [],
      improvements: []
    };
    
    // テキストが空の場合は空の結果を返す
    if (!text || text.trim() === '') {
      return result;
    }
    
    // 曖昧語の検出
    mediaRules.ambiguousPhrases.forEach(phrase => {
      const regex = new RegExp(phrase.text, 'g');
      const matches = text.match(regex);
      
      if (matches && matches.length > 0) {
        result.ambiguousPhrases.push({
          text: phrase.text,
          count: matches.length,
          suggestion: phrase.suggestion
        });
      }
    });
    
    // 語尾かぶりの検出
    const sentences = text.split(/[。．.!?！？]/);
    const endingPatterns = {};
    
    sentences.forEach(sentence => {
      const trimmed = sentence.trim();
      if (trimmed.length === 0) return;
      
      // 語尾パターンを検出（最後の5文字）
      const ending = trimmed.slice(-5);
      endingPatterns[ending] = (endingPatterns[ending] || 0) + 1;
    });
    
    for (const [pattern, count] of Object.entries(endingPatterns)) {
      if (count >= 3) {
        result.repetitiveEndings.push({
          pattern,
          count,
          suggestion: `語尾の表現を変えてみてください。現在 ${count} 回使用されています。`
        });
      }
    }
    
    // メディア特有のチェック
    mediaRules.mediaSpecificRules.forEach(rule => {
      const regex = new RegExp(rule.pattern, 'g');
      const matches = text.match(regex);
      
      if (matches && matches.length > 0) {
        result.mediaSpecificIssues.push({
          pattern: rule.pattern,
          count: matches.length,
          description: rule.description
        });
      }
    });
    
    // スコア計算（シンプルな例）
    const totalIssues = result.ambiguousPhrases.length + 
                         result.repetitiveEndings.length + 
                         result.mediaSpecificIssues.length;
    
    const maxScore = 100;
    const issueWeight = 5; // 1問題あたりの減点
    
    result.mediaScore = Math.max(0, maxScore - (totalIssues * issueWeight));
    
    // 改善提案（基本的なルール）
    if (result.mediaScore < 70) {
      result.improvements.push('曖昧な表現や重複を避け、より具体的で多様な表現を心がけましょう。');
    }
    
    // 詳細分析が必要な場合のみ追加の分析を実行
    if (detailedAnalysis) {
      // 文章の長さチェック
      const averageSentenceLength = text.length / sentences.length;
      
      if (averageSentenceLength > 50) {
        result.improvements.push(`文が平均${Math.round(averageSentenceLength)}文字と長めです。短く区切ることを検討してください。`);
      }
      
      // 読みやすさスコアの計算（簡易版）
      const wordCount = text.replace(/\s+/g, ' ').split(' ').length;
      const characterCount = text.replace(/\s+/g, '').length;
      const sentenceCount = sentences.length;
      
      // 簡易的な読みやすさ指標
      const readabilityScore = 100 - (characterCount / sentenceCount / 10);
      
      if (readabilityScore < 60) {
        result.improvements.push('文章が複雑すぎる可能性があります。短い文に分けることを検討してください。');
      }
    }
    
    return result;
  } catch (error) {
    console.error('テキスト分析エラー:', error);
    throw new Error('テキスト分析中にエラーが発生しました: ' + error.message);
  }
}

/**
 * Google Drive検索を実行
 */
async function searchDrive(keyword, fileTypes, period) {
  try {
    const auth = getAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    
    // ファイルタイプによるクエリの構築
    let mimeTypeQuery = '';
    
    if (fileTypes && fileTypes.length > 0) {
      const mimeTypes = [];
      
      if (fileTypes.includes('docs')) {
        mimeTypes.push('mimeType="application/vnd.google-apps.document"');
      }
      
      if (fileTypes.includes('pdf')) {
        mimeTypes.push('mimeType="application/pdf"');
      }
      
      if (fileTypes.includes('text')) {
        mimeTypes.push('mimeType="text/plain"');
      }
      
      if (mimeTypes.length > 0) {
        mimeTypeQuery = '(' + mimeTypes.join(' or ') + ')';
      }
    }
    
    // 期間によるクエリの構築
    let dateQuery = '';
    
    if (period && period !== 'all') {
      const now = new Date();
      let dateThreshold = new Date();
      
      if (period === '1w') {
        dateThreshold.setDate(now.getDate() - 7);
      } else if (period === '1m') {
        dateThreshold.setMonth(now.getMonth() - 1);
      } else if (period === '3m') {
        dateThreshold.setMonth(now.getMonth() - 3);
      }
      
      dateQuery = `modifiedTime > '${dateThreshold.toISOString()}'`;
    }
    
    // 検索クエリの構築
    let query = `fullText contains '${keyword}' and trashed=false`;
    
    if (mimeTypeQuery) {
      query += ` and ${mimeTypeQuery}`;
    }
    
    if (dateQuery) {
      query += ` and ${dateQuery}`;
    }
    
    // 検索の実行
    const response = await drive.files.list({
      q: query,
      pageSize: 20,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime)',
      orderBy: 'modifiedTime desc'
    });
    
    // 検索結果の処理
    const items = await Promise.all(response.data.files.map(async file => {
      let snippet = '';
      
      // 検索結果のスニペット（一致部分のコンテキスト）を取得
      try {
        if (file.mimeType === 'application/vnd.google-apps.document') {
          const docResponse = await drive.files.export({
            fileId: file.id,
            mimeType: 'text/plain'
          });
          
          const content = docResponse.data;
          snippet = extractSnippet(content, keyword);
        } else {
          // テキストファイルや他の形式の場合はスニペットを取得しない
          snippet = 'プレビューするにはリンクをクリックしてください。';
        }
      } catch (error) {
        console.error('スニペット取得エラー:', error);
        snippet = 'コンテンツを取得できませんでした。';
      }
      
      return {
        id: file.id,
        title: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        modifiedTime: file.modifiedTime,
        snippet
      };
    }));
    
    return {
      items,
      hasMore: !!response.data.nextPageToken
    };
  } catch (error) {
    console.error('Drive検索エラー:', error);
    throw new Error('Drive検索中にエラーが発生しました: ' + error.message);
  }
}

/**
 * テキストから検索キーワードに関連するスニペットを抽出
 */
function extractSnippet(text, keyword) {
  const maxLength = 150;
  const regex = new RegExp(`(.{0,50}${keyword}.{0,50})`, 'i');
  const match = text.match(regex);
  
  if (match && match[1]) {
    let snippet = match[1];
    
    // スニペットが最大長を超える場合は切り詰める
    if (snippet.length > maxLength) {
      snippet = '...' + snippet.substring(snippet.length - maxLength + 3);
    }
    
    if (!snippet.endsWith('.')) {
      snippet += '...';
    }
    
    return snippet;
  }
  
  return 'キーワードの一致箇所のプレビューを取得できませんでした。';
}

module.exports = {
  getMediaRules,
  analyzeText,
  searchDrive
};