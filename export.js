/**
 * TextStation Pro - PDF/CSV出力処理
 * PDF生成と出力処理のロジックを提供
 */

const PDFDocument = require('pdfkit');
const { Storage } = require('@google-cloud/storage');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const stream = require('stream');

// 認証クライアント
let jwtClient = null;

/**
 * Google認証クライアントを初期化
 */
function getAuthClient() {
  if (jwtClient) return jwtClient;
  
  jwtClient = new JWT({
    email: process.env.FIREBASE_CLIENT_EMAIL,
    key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.appdata'
    ]
  });
  
  return jwtClient;
}

/**
 * PDFを生成する
 */
async function generatePDF(text, results, options) {
  try {
    const {
      title = 'TextStation出力ドキュメント',
      font = 'noto',
      fontSize = 11,
      includeHeader = true,
      includeFooter = true
    } = options || {};
    
    // PDFドキュメントを作成
    const doc = new PDFDocument({
      margins: {
        top: 50,
        bottom: 50,
        left: 50,
        right: 50
      },
      info: {
        Title: title,
        Author: 'TextStation Pro',
        Creator: 'TextStation Pro'
      }
    });
    
    // フォント設定
    let fontFamily = 'fonts/NotoSansJP-Regular.ttf';
    
    switch (font) {
      case 'meiryo':
        fontFamily = 'fonts/meiryo.ttf';
        break;
      case 'gothic':
        fontFamily = 'fonts/msgothic.ttf';
        break;
      case 'mincho':
        fontFamily = 'fonts/msmincho.ttf';
        break;
    }
    
    doc.font(fontFamily);
    doc.fontSize(fontSize);
    
    // ヘッダーを追加
    if (includeHeader) {
      doc.fontSize(fontSize + 2)
         .text(title, {
           align: 'center'
         })
         .moveDown(0.5)
         .fontSize(fontSize - 2)
         .text(`作成日: ${new Date().toLocaleDateString('ja-JP')}`, {
           align: 'center'
         })
         .moveDown(2)
         .fontSize(fontSize);
      
      // 区切り線
      doc.moveTo(50, doc.y)
         .lineTo(doc.page.width - 50, doc.y)
         .stroke()
         .moveDown(1);
    }
    
    // 本文を追加
    doc.fontSize(fontSize)
       .text('【テキスト】', {
         underline: true
       })
       .moveDown(0.5)
       .text(text)
       .moveDown(2);
    
    // 分析結果があれば追加
    if (results && results.trim() !== '') {
      doc.text('【分析結果】', {
         underline: true
       })
       .moveDown(0.5)
       .text(results)
       .moveDown(1);
    }
    
    // フッターを追加（各ページ）
    if (includeFooter) {
      const totalPages = doc.bufferedPageRange().count;
      
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        
        // 区切り線
        doc.moveTo(50, doc.page.height - 50)
           .lineTo(doc.page.width - 50, doc.page.height - 50)
           .stroke();
        
        // ページ番号
        doc.fontSize(fontSize - 2)
           .text(
             `ページ ${i + 1} / ${totalPages}`,
             50,
             doc.page.height - 40,
             { align: 'center' }
           );
      }
    }
    
    // PDFバッファを生成
    const pdfBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
    
    // PDFをFirebase Storageにアップロード
    const storageUrl = await uploadToStorage(pdfBuffer, `${title}.pdf`);
    
    // PDFをGoogle Driveにもバックアップ
    const driveUrl = await uploadToDrive(pdfBuffer, `${title}.pdf`);
    
    return {
      success: true,
      title,
      url: storageUrl,
      driveUrl
    };
  } catch (error) {
    console.error('PDF生成エラー:', error);
    throw new Error('PDF生成中にエラーが発生しました: ' + error.message);
  }
}

/**
 * PDFをFirebase Storageにアップロード
 */
async function uploadToStorage(buffer, filename) {
  try {
    const storage = new Storage({
      projectId: process.env.FIREBASE_PROJECT_ID,
      credentials: {
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      }
    });
    
    const bucket = storage.bucket(process.env.FIREBASE_STORAGE_BUCKET);
    const file = bucket.file(`exports/${filename}`);
    
    // バッファをアップロード
    await file.save(buffer, {
      contentType: 'application/pdf',
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          createdAt: new Date().toISOString()
        }
      }
    });
    
    // 24時間有効なダウンロードURLを生成
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000 // 24時間
    });
    
    return url;
  } catch (error) {
    console.error('Storage アップロードエラー:', error);
    throw new Error('Storageへのアップロード中にエラーが発生しました: ' + error.message);
  }
}

/**
 * PDFをGoogle Driveにアップロード
 */
async function uploadToDrive(buffer, filename) {
  try {
    const auth = getAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    
    // バッファからストリームを作成
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);
    
    // Google Driveにアップロード
    const response = await drive.files.create({
      requestBody: {
        name: filename,
        mimeType: 'application/pdf',
        description: 'TextStation Proから出力されたPDFファイル'
      },
      media: {
        mimeType: 'application/pdf',
        body: bufferStream
      }
    });
    
    // 新規作成されたファイルのID
    const fileId = response.data.id;
    
    // ウェブビュー用のURLを作成
    const webViewLink = `https://drive.google.com/file/d/${fileId}/view`;
    
    return webViewLink;
  } catch (error) {
    console.error('Drive アップロードエラー:', error);
    // Driveアップロードは補助的な機能なので、エラーがあっても処理を続行
    return null;
  }
}

/**
 * CSVエクスポート機能（将来拡張用）
 */
function exportToCSV(data, options) {
  // 将来実装用の枠組み
  return {
    success: false,
    message: 'CSV出力機能は現在開発中です。'
  };
}

module.exports = {
  generatePDF,
  exportToCSV
};