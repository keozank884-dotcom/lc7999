const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// ==================== CẤU HÌNH ====================
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'tranhoang2286.json';
const HISTORY_FILE = 'tranhoang2286_history.json';
const PATTERN_DB_FILE = 'pattern_database.json'; // File lưu trữ cầu vô hạn

// ==================== CODE LC79 (LẨU CUA 79) ====================

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== HỆ THỐNG LƯU TRỮ CẦU VÔ HẠN ====================

let patternDatabase = {
  totalPatterns: 0,
  patterns: [], // Lưu tất cả cầu đã học
  patternHistory: {}, // Lưu lịch sử từng loại cầu
  lastUpdated: null,
  stats: {
    totalLearned: 0,
    byType: {},
    byConfidence: {
      high: 0,    // > 80%
      medium: 0,  // 60-80%
      low: 0      // < 60%
    },
    accuracyByType: {}
  }
};

// Khởi tạo pattern database
function initializePatternDatabase() {
  try {
    if (fs.existsSync(PATTERN_DB_FILE)) {
      const data = fs.readFileSync(PATTERN_DB_FILE, 'utf8');
      const parsed = JSON.parse(data);
      patternDatabase = parsed;
      console.log(`✅ Loaded pattern database: ${patternDatabase.totalPatterns} patterns`);
      return;
    }
  } catch (error) {
    console.error('❌ Error loading pattern database:', error.message);
  }
  
  // Tạo mới nếu chưa có
  patternDatabase = {
    totalPatterns: 0,
    patterns: [],
    patternHistory: {},
    lastUpdated: new Date().toISOString(),
    stats: {
      totalLearned: 0,
      byType: {},
      byConfidence: {
        high: 0,
        medium: 0,
        low: 0
      },
      accuracyByType: {}
    }
  };
  savePatternDatabase();
}

function savePatternDatabase() {
  try {
    fs.writeFileSync(PATTERN_DB_FILE, JSON.stringify(patternDatabase, null, 2));
  } catch (error) {
    console.error('❌ Error saving pattern database:', error.message);
  }
}

// Hàm thêm cầu mới vào database
function addPatternToDatabase(patternData) {
  const patternId = `${patternData.type}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  
  const newPattern = {
    id: patternId,
    type: patternData.type,
    name: patternData.name || patternData.type,
    prediction: patternData.prediction,
    confidence: patternData.confidence || 65,
    pattern: patternData.pattern || [],
    results: patternData.results || [],
    totalOccurrences: 1,
    successCount: 0,
    failCount: 0,
    accuracy: 0,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [{
      timestamp: new Date().toISOString(),
      prediction: patternData.prediction,
      confidence: patternData.confidence || 65,
      result: null // Sẽ cập nhật sau khi có kết quả
    }]
  };
  
  patternDatabase.patterns.push(newPattern);
  patternDatabase.totalPatterns = patternDatabase.patterns.length;
  patternDatabase.lastUpdated = new Date().toISOString();
  patternDatabase.stats.totalLearned = patternDatabase.patterns.length;
  
  // Cập nhật thống kê theo loại
  if (!patternDatabase.stats.byType[patternData.type]) {
    patternDatabase.stats.byType[patternData.type] = 0;
  }
  patternDatabase.stats.byType[patternData.type]++;
  
  // Cập nhật thống kê theo confidence
  if (patternData.confidence >= 80) {
    patternDatabase.stats.byConfidence.high++;
  } else if (patternData.confidence >= 60) {
    patternDatabase.stats.byConfidence.medium++;
  } else {
    patternDatabase.stats.byConfidence.low++;
  }
  
  savePatternDatabase();
  return newPattern;
}

// Hàm cập nhật kết quả của cầu
function updatePatternResult(patternId, isCorrect) {
  const pattern = patternDatabase.patterns.find(p => p.id === patternId);
  if (!pattern) return false;
  
  if (isCorrect) {
    pattern.successCount++;
  } else {
    pattern.failCount++;
  }
  
  pattern.totalOccurrences = pattern.successCount + pattern.failCount;
  pattern.accuracy = pattern.totalOccurrences > 0 
    ? (pattern.successCount / pattern.totalOccurrences * 100) 
    : 0;
  pattern.lastSeen = new Date().toISOString();
  pattern.updatedAt = new Date().toISOString();
  
  // Cập nhật history
  const lastHistory = pattern.history[pattern.history.length - 1];
  if (lastHistory && lastHistory.result === null) {
    lastHistory.result = isCorrect;
    lastHistory.timestamp = new Date().toISOString();
  } else {
    pattern.history.push({
      timestamp: new Date().toISOString(),
      prediction: pattern.prediction,
      confidence: pattern.confidence,
      result: isCorrect
    });
  }
  
  // Giới hạn history để tránh quá lớn (giữ 1000 gần nhất)
  if (pattern.history.length > 1000) {
    pattern.history = pattern.history.slice(-1000);
  }
  
  // Cập nhật accuracy by type
  if (!patternDatabase.stats.accuracyByType[pattern.type]) {
    patternDatabase.stats.accuracyByType[pattern.type] = {
      total: 0,
      correct: 0,
      accuracy: 0
    };
  }
  patternDatabase.stats.accuracyByType[pattern.type].total++;
  if (isCorrect) {
    patternDatabase.stats.accuracyByType[pattern.type].correct++;
  }
  patternDatabase.stats.accuracyByType[pattern.type].accuracy = 
    (patternDatabase.stats.accuracyByType[pattern.type].correct / 
     patternDatabase.stats.accuracyByType[pattern.type].total * 100);
  
  patternDatabase.lastUpdated = new Date().toISOString();
  savePatternDatabase();
  return true;
}

// Hàm lấy cầu theo loại
function getPatternsByType(type) {
  return patternDatabase.patterns.filter(p => p.type === type);
}

// Hàm lấy cầu có độ chính xác cao
function getHighAccuracyPatterns(minAccuracy = 70) {
  return patternDatabase.patterns.filter(p => p.accuracy >= minAccuracy);
}

// Hàm tìm cầu tương tự
function findSimilarPatterns(pattern, maxResults = 10) {
  // Tìm cầu có pattern gần giống
  const similar = patternDatabase.patterns.filter(p => {
    // So sánh pattern
    if (!p.pattern || p.pattern.length === 0) return false;
    if (!pattern || pattern.length === 0) return false;
    
    // Kiểm tra độ tương đồng
    let matches = 0;
    const minLen = Math.min(p.pattern.length, pattern.length);
    for (let i = 0; i < minLen; i++) {
      if (p.pattern[i] === pattern[i]) matches++;
    }
    const similarity = matches / Math.max(p.pattern.length, pattern.length);
    return similarity > 0.5;
  });
  
  // Sắp xếp theo độ chính xác
  similar.sort((a, b) => b.accuracy - a.accuracy);
  return similar.slice(0, maxResults);
}

// ==================== HỌC CẦU TỰ ĐỘNG ====================

function learnPatternFromData(data, type) {
  if (!data || data.length < 10) return;
  
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  // Phân tích các pattern và học
  const patterns = analyzeAllPatterns(results, sums, type);
  
  let newPatternsCount = 0;
  patterns.forEach(pattern => {
    // Kiểm tra xem pattern đã tồn tại chưa
    const exists = patternDatabase.patterns.some(p => 
      p.type === pattern.type && 
      p.name === pattern.name &&
      p.prediction === pattern.prediction
    );
    
    if (!exists) {
      addPatternToDatabase(pattern);
      newPatternsCount++;
    }
  });
  
  if (newPatternsCount > 0) {
    console.log(`📚 Học được ${newPatternsCount} cầu mới từ ${type.toUpperCase()}`);
    console.log(`📊 Tổng cầu đã học: ${patternDatabase.totalPatterns}`);
  }
}

function analyzeAllPatterns(results, sums, type) {
  const patterns = [];
  
  // 1. Cầu Bệt
  const bet = analyzeCauBetLearn(results);
  if (bet) patterns.push({ ...bet, type: 'cau_bet' });
  
  // 2. Cầu Đảo 1-1
  const dao11 = analyzeCauDao11Learn(results);
  if (dao11) patterns.push({ ...dao11, type: 'cau_dao_11' });
  
  // 3. Cầu 2-2
  const cau22 = analyzeCau22Learn(results);
  if (cau22) patterns.push({ ...cau22, type: 'cau_22' });
  
  // 4. Cầu 3-3
  const cau33 = analyzeCau33Learn(results);
  if (cau33) patterns.push({ ...cau33, type: 'cau_33' });
  
  // 5. Cầu 1-2-1
  const cau121 = analyzeCau121Learn(results);
  if (cau121) patterns.push({ ...cau121, type: 'cau_121' });
  
  // 6. Cầu 1-2-3
  const cau123 = analyzeCau123Learn(results);
  if (cau123) patterns.push({ ...cau123, type: 'cau_123' });
  
  // 7. Cầu 3-2-1
  const cau321 = analyzeCau321Learn(results);
  if (cau321) patterns.push({ ...cau321, type: 'cau_321' });
  
  // 8. Cầu Nhảy Cóc
  const nhayCoc = analyzeCauNhayCocLearn(results);
  if (nhayCoc) patterns.push({ ...nhayCoc, type: 'cau_nhay_coc' });
  
  // 9. Cầu Nhịp Nghiêng
  const nhipNghieng = analyzeCauNhipNghiengLearn(results);
  if (nhipNghieng) patterns.push({ ...nhipNghieng, type: 'cau_nhip_nghieng' });
  
  // 10. Cầu 3 Ván 1
  const cau3Van1 = analyzeCau3Van1Learn(results);
  if (cau3Van1) patterns.push({ ...cau3Van1, type: 'cau_3van1' });
  
  // 11. Cầu Rồng
  const cauRong = analyzeCauRongLearn(results);
  if (cauRong) patterns.push({ ...cauRong, type: 'cau_rong' });
  
  // 12. Cầu Gãy (từ sunphhuy)
  const cauGay = analyzeCauGayLearn(results);
  if (cauGay) patterns.push({ ...cauGay, type: 'cau_gay' });
  
  // 13. Mẫu Lặp (từ sunphhuy)
  const mauLap = analyzeMauLapLearn(results);
  if (mauLap) patterns.push({ ...mauLap, type: 'mau_lap' });
  
  // 14. Phân tích Vị (từ sunphhuy)
  const vi = analyzeViLearn(sums);
  if (vi) patterns.push({ ...vi, type: 'vi_phan_tich' });
  
  return patterns;
}

// ==================== CÁC HÀM HỌC PATTERN ====================

function analyzeCauBetLearn(results) {
  if (results.length < 3) return null;
  
  let streakType = results[0];
  let streakLength = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 3) {
    return {
      name: `Cầu Bệt ${streakLength} phiên ${streakType}`,
      prediction: streakType,
      confidence: Math.min(85, 65 + streakLength * 2),
      pattern: results.slice(0, streakLength)
    };
  }
  return null;
}

function analyzeCauDao11Learn(results) {
  if (results.length < 4) return null;
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 4) {
    return {
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(80, 65 + alternatingLength * 2),
      pattern: results.slice(0, alternatingLength)
    };
  }
  return null;
}

function analyzeCau22Learn(results) {
  if (results.length < 4) return null;
  
  let pairs = [];
  for (let i = 0; i < results.length - 1; i += 2) {
    if (results[i] === results[i + 1]) {
      pairs.push(results[i]);
    } else {
      break;
    }
  }
  
  if (pairs.length >= 2) {
    const isAlternating = pairs.every((p, idx) => idx === 0 || p !== pairs[idx - 1]);
    if (isAlternating) {
      return {
        name: `Cầu 2-2 (${pairs.length} cặp)`,
        prediction: pairs[pairs.length - 1] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.min(78, 65 + pairs.length * 3),
        pattern: pairs
      };
    }
  }
  return null;
}

function analyzeCau33Learn(results) {
  if (results.length < 6) return null;
  
  let triples = [];
  for (let i = 0; i < results.length - 2; i += 3) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      triples.push(results[i]);
    } else {
      break;
    }
  }
  
  if (triples.length >= 1) {
    return {
      name: `Cầu 3-3 (${triples.length} bộ ba)`,
      prediction: triples[triples.length - 1],
      confidence: Math.min(80, 68 + triples.length * 4),
      pattern: triples
    };
  }
  return null;
}

function analyzeCau121Learn(results) {
  if (results.length < 4) return null;
  
  const pattern = results.slice(0, 4);
  if (pattern[0] !== pattern[1] && 
      pattern[1] === pattern[2] && 
      pattern[2] !== pattern[3] &&
      pattern[0] === pattern[3]) {
    return {
      name: 'Cầu 1-2-1',
      prediction: pattern[0],
      confidence: 72,
      pattern: pattern
    };
  }
  return null;
}

function analyzeCau123Learn(results) {
  if (results.length < 6) return null;
  
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      return {
        name: 'Cầu 1-2-3',
        prediction: first,
        confidence: 74,
        pattern: results.slice(0, 6)
      };
    }
  }
  return null;
}

function analyzeCau321Learn(results) {
  if (results.length < 6) return null;
  
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    return {
      name: 'Cầu 3-2-1',
      prediction: next2[0],
      confidence: 76,
      pattern: results.slice(0, 6)
    };
  }
  return null;
}

function analyzeCauNhayCocLearn(results) {
  if (results.length < 6) return null;
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return {
        name: 'Cầu Nhảy Cóc',
        prediction: skipPattern[0],
        confidence: 68,
        pattern: skipPattern.slice(0, 3)
      };
    }
  }
  return null;
}

function analyzeCauNhipNghiengLearn(results) {
  if (results.length < 5) return null;
  
  const last5 = results.slice(0, 5);
  const taiCount = last5.filter(r => r === 'Tài').length;
  
  if (taiCount >= 4) {
    return {
      name: 'Cầu Nhịp Nghiêng (Tài)',
      prediction: 'Tài',
      confidence: 70,
      pattern: last5
    };
  } else if (taiCount <= 1) {
    return {
      name: 'Cầu Nhịp Nghiêng (Xỉu)',
      prediction: 'Xỉu',
      confidence: 70,
      pattern: last5
    };
  }
  return null;
}

function analyzeCau3Van1Learn(results) {
  if (results.length < 4) return null;
  
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  
  if (taiCount === 3) {
    return {
      name: 'Cầu 3 Ván 1 (3T-1X)',
      prediction: 'Xỉu',
      confidence: 68,
      pattern: last4
    };
  } else if (taiCount === 1) {
    return {
      name: 'Cầu 3 Ván 1 (3X-1T)',
      prediction: 'Tài',
      confidence: 68,
      pattern: last4
    };
  }
  return null;
}

function analyzeCauRongLearn(results) {
  if (results.length < 6) return null;
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 6) {
    return {
      name: `Cầu Rồng ${streakLength} phiên`,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.min(88, 75 + streakLength),
      pattern: results.slice(0, streakLength)
    };
  }
  return null;
}

// ==================== PATTERN HỌC TỪ SUNPHHUY ====================

function analyzeCauGayLearn(results) {
  if (results.length < 5) return null;
  
  const arr = results.slice(0, 6);
  
  // Mẫu AAABB → B (3-2)
  if (arr[0] === arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[3] === arr[4]) {
    return {
      name: `Cầu Gãy 3-2 (${arr[0]}${arr[0]}${arr[0]}${arr[3]}${arr[3]})`,
      prediction: arr[3],
      confidence: 74,
      pattern: arr.slice(0, 5)
    };
  }
  
  // Mẫu AABBB → B (2-3)
  if (arr[0] === arr[1] && arr[1] !== arr[2] && arr[2] === arr[3] && arr[3] === arr[4]) {
    return {
      name: `Cầu Gãy 2-3 (${arr[0]}${arr[0]}${arr[2]}${arr[2]}${arr[2]})`,
      prediction: arr[2],
      confidence: 74,
      pattern: arr.slice(0, 5)
    };
  }
  
  // Mẫu ABBA → B (1-2-1)
  if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
    return {
      name: `Cầu Gãy 1-2-1 (${arr[0]}${arr[1]}${arr[1]}${arr[0]})`,
      prediction: arr[1],
      confidence: 72,
      pattern: arr.slice(0, 4)
    };
  }
  return null;
}

function analyzeMauLapLearn(results) {
  if (results.length < 6) return null;
  
  const arr = results.slice(0, 10);
  
  for (let len = 2; len <= 4; len++) {
    let pattern = arr.slice(0, len);
    for (let i = len; i < arr.length - len; i++) {
      let sub = arr.slice(i, i + len);
      if (JSON.stringify(sub) === JSON.stringify(pattern)) {
        let nextIndex = i + len;
        if (nextIndex < arr.length) {
          return {
            name: `Mẫu Lặp "${pattern.join('-')}"`,
            prediction: arr[nextIndex],
            confidence: 88,
            pattern: arr.slice(0, nextIndex + 1)
          };
        }
      }
    }
  }
  return null;
}

function analyzeViLearn(sums) {
  if (sums.length < 5) return null;
  
  const last = sums[0];
  const prev = sums[1];
  const slice = sums.slice(0, 5);
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  
  if (last >= 15) {
    return {
      name: `Vị Cực Đại (Tổng ${last})`,
      prediction: 'Xỉu',
      confidence: 75,
      pattern: sums.slice(0, 5)
    };
  }
  
  if (last <= 5) {
    return {
      name: `Vị Cực Tiểu (Tổng ${last})`,
      prediction: 'Tài',
      confidence: 75,
      pattern: sums.slice(0, 5)
    };
  }
  
  if (avg > 11 && last > prev) {
    return {
      name: `Vị Bão Hòa (TB ${avg.toFixed(1)})`,
      prediction: 'Xỉu',
      confidence: 68,
      pattern: sums.slice(0, 5)
    };
  }
  
  if (avg < 10 && last < prev) {
    return {
      name: `Vị Cạn Kiệt (TB ${avg.toFixed(1)})`,
      prediction: 'Tài',
      confidence: 68,
      pattern: sums.slice(0, 5)
    };
  }
  
  return null;
}

// ==================== PHẦN CŨ CỦA LC79 (GIỮ NGUYÊN 100%) ====================

let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.0,
  'cau_dao_11': 1.0,
  'cau_22': 1.0,
  'cau_33': 1.0,
  'cau_121': 1.0,
  'cau_123': 1.0,
  'cau_321': 1.0,
  'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.0,
  'cau_3van1': 1.0,
  'cau_be_cau': 1.0,
  'cau_chu_ky': 1.0,
  'distribution': 1.0,
  'dice_pattern': 1.0,
  'sum_trend': 1.0,
  'edge_cases': 1.0,
  'momentum': 1.0,
  'cau_tu_nhien': 1.0,
  'dice_trend_line': 1.0,
  'dice_trend_line_md5': 1.0,
  'break_pattern_hu': 1.0,
  'break_pattern_md5': 1.0,
  'fibonacci': 1.0,
  'resistance_support': 1.0,
  'wave': 1.0,
  'golden_ratio': 1.0,
  'day_gay': 1.0,
  'day_gay_md5': 1.0,
  'cau_44': 1.0,
  'cau_55': 1.0,
  'cau_212': 1.0,
  'cau_1221': 1.0,
  'cau_2112': 1.0,
  'cau_gap': 1.0,
  'cau_ziczac': 1.0,
  'cau_doi': 1.0,
  'cau_rong': 1.0,
  'smart_bet': 1.0,
  'break_pattern_advanced': 1.0,
  'break_streak': 1.0,
  'alternating_break': 1.0,
  'double_pair_break': 1.0,
  'triple_pattern': 1.0,
  'tong_phan_tich': 1.5,
  'xu_huong_manh': 1.3,
  'dao_chieu': 1.4,
  'cau_gay': 1.2,
  'mau_lap': 1.3,
  'vi_phan_tich': 1.2
};

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('✅ Learning data loaded successfully from tranhoang2286.json');
    }
  } catch (error) {
    console.error('❌ Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('❌ Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('✅ Prediction history loaded successfully from tranhoang2286_history.json');
      console.log(`  📊 Hu: ${predictionHistory.hu.length} records`);
      console.log(`  📊 MD5: ${predictionHistory.md5.length} records`);
    }
  } catch (error) {
    console.error('❌ Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    const dataToSave = {
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('❌ Error saving prediction history:', error.message);
  }
}

function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) {
    return null;
  }
  
  return apiData.list.map(item => {
    const result = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
    return {
      Phien: item.id,
      Ket_qua: result,
      Xuc_xac_1: item.dices[0],
      Xuc_xac_2: item.dices[1],
      Xuc_xac_3: item.dices[2],
      Tong: item.point
    };
  });
}

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('❌ Error fetching HU data:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('❌ Error fetching MD5 data:', error.message);
    return null;
  }
}

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = {
        total: 0,
        correct: 0,
        accuracy: 0.5,
        recentResults: [],
        lastAdjustment: null
      };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  
  stats.total++;
  if (isCorrect) stats.correct++;
  
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 20) {
    stats.recentResults.shift();
  }
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  
  if (stats.recentResults.length >= 5) {
    if (recentAccuracy > 0.65) {
      newWeight = Math.min(3.0, oldWeight * 1.1);
    } else if (recentAccuracy < 0.35) {
      newWeight = Math.max(0.2, oldWeight * 0.9);
    }
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet',
    'Cầu Đảo 1-1': 'cau_dao_11',
    'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33',
    'Cầu 4-4': 'cau_44',
    'Cầu 5-5': 'cau_55',
    'Cầu 1-2-1': 'cau_121',
    'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321',
    'Cầu 2-1-2': 'cau_212',
    'Cầu 1-2-2-1': 'cau_1221',
    'Cầu 2-1-1-2': 'cau_2112',
    'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng',
    'Cầu 3 Ván 1': 'cau_3van1',
    'Cầu Bẻ Cầu': 'cau_be_cau',
    'Cầu Chu Kỳ': 'cau_chu_ky',
    'Cầu Gấp': 'cau_gap',
    'Cầu Ziczac': 'cau_ziczac',
    'Cầu Đôi': 'cau_doi',
    'Cầu Rồng': 'cau_rong',
    'Đảo Xu Hướng': 'smart_bet',
    'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution',
    'Tổng TB': 'dice_pattern',
    'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases',
    'Biến động': 'momentum',
    'Cầu Tự Nhiên': 'cau_tu_nhien',
    'Biểu Đồ Đường': 'dice_trend_line',
    'MD5 Biểu Đồ': 'dice_trend_line_md5',
    'Cầu Liên Tục': 'break_pattern_hu',
    'MD5 Cầu': 'break_pattern_md5',
    'Dây Gãy': 'day_gay',
    'MD5 Dây Gãy': 'day_gay_md5',
    'Tổng Phân Tích': 'tong_phan_tich',
    'Xu Hướng Mạnh': 'xu_huong_manh',
    'Đảo Chiều': 'dao_chieu',
    'Gãy': 'cau_gay',
    'Mẫu Lặp': 'mau_lap',
    'Vị Cực Đại': 'vi_phan_tich',
    'Vị Cực Tiểu': 'vi_phan_tich',
    'Vị Bão Hòa': 'vi_phan_tich',
    'Vị Cạn Kiệt': 'vi_phan_tich',
    'Vị Ổn Định': 'vi_phan_tich'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 10) return 0;
  
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  
  if (accuracy > 0.70) return 10;
  if (accuracy > 0.60) return 6;
  if (accuracy > 0.50) return 3;
  if (accuracy < 0.30) return -10;
  if (accuracy < 0.40) return -6;
  
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  if (streakInfo.currentStreak <= -4) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  
  patterns.forEach(p => {
    const patternId = getPatternIdFromName(p.name || p);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 5) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const weight = learningData[type].patternWeights[patternId] || 1;
        
        if (p.prediction === 'Tài') {
          taiPatternScore += recentAcc * weight;
        } else {
          xiuPatternScore += recentAcc * weight;
        }
      }
    }
  });
  
  if (Math.abs(taiPatternScore - xiuPatternScore) > 0.7) {
    return taiPatternScore > xiuPatternScore ? 'Tài' : 'Xỉu';
  }
  
  return prediction;
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 500);
  }
  
  saveLearningData();
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      
      const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
        
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) {
        learningData[type].recentAccuracy.shift();
      }
      
      if (pred.patterns && pred.patterns.length > 0) {
        pred.patterns.forEach(patternName => {
          const patternId = getPatternIdFromName(patternName);
          if (patternId) {
            updatePatternPerformance(type, patternId, pred.isCorrect);
          }
        });
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

async function updateHistoryStatus(type) {
  try {
    let data = null;
    if (type === 'hu') {
      data = await fetchDataHu();
    } else {
      data = await fetchDataMd5();
    }
    
    if (!data || data.length === 0) return;
    
    let updated = false;
    for (const record of predictionHistory[type]) {
      if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
      
      const actualResult = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
      if (actualResult) {
        const duDoanNormalized = record.Du_doan;
        const ketQuaThucTe = actualResult.Ket_qua;
        
        if (duDoanNormalized === ketQuaThucTe) {
          record.ket_qua_du_doan = 'Đúng ✅';
        } else {
          record.ket_qua_du_doan = 'Sai ❌';
        }
        updated = true;
      }
    }
    
    if (updated) {
      savePredictionHistory();
    }
  } catch (error) {
    console.error(`❌ Error updating ${type} history status:`, error.message);
  }
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        
        // Học cầu từ dữ liệu
        learnPatternFromData(dataHu, 'hu');
        
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`🎯 [Auto] Hu phien ${nextHuPhien}: ${result.prediction} (${result.confidence}%)`);
        console.log(`📚 Tổng cầu đã học: ${patternDatabase.totalPatterns}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        
        // Học cầu từ dữ liệu
        learnPatternFromData(dataMd5, 'md5');
        
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`🎯 [Auto] MD5 phien ${nextMd5Phien}: ${result.prediction} (${result.confidence}%)`);
        console.log(`📚 Tổng cầu đã học: ${patternDatabase.totalPatterns}`);
      }
    }
    
    await updateHistoryStatus('hu');
    await updateHistoryStatus('md5');
    
    savePredictionHistory();
    saveLearningData();
    
  } catch (error) {
    console.error('❌ [Auto] Error processing predictions:', error.message);
  }
}

function startAutoSaveTask() {
  console.log(`⏰ Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  
  setTimeout(() => {
    autoProcessPredictions();
  }, 5000);
  
  setInterval(() => {
    autoProcessPredictions();
  }, AUTO_SAVE_INTERVAL);
}

// ==================== CÁC HÀM PHÂN TÍCH CẢI TIẾN (GIỮ NGUYÊN) ====================

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  
  const recent10 = data.slice(0, 10);
  const sums = recent10.map(d => d.Tong);
  const results = recent10.map(d => d.Ket_qua);
  
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  const taiCount = results.filter(r => r === 'Tài').length;
  const xiuCount = results.filter(r => r === 'Xỉu').length;
  
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  
  const weight = getPatternWeight(type, 'tong_phan_tich');
  
  if (sumTrend > 1.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(75 + Math.abs(sumTrend) * 3),
      name: `Tổng Phân Tích (Tổng tăng ${sumTrend.toFixed(1)} → Xỉu)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (sumTrend < -1.5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(75 + Math.abs(sumTrend) * 3),
      name: `Tổng Phân Tích (Tổng giảm ${Math.abs(sumTrend).toFixed(1)} → Tài)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (Math.abs(taiCount - xiuCount) >= 3) {
    const lech = taiCount > xiuCount ? 'Tài' : 'Xỉu';
    const prediction = lech === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(70 + Math.abs(taiCount - xiuCount) * 3),
      name: `Tổng Phân Tích (Lệch ${Math.abs(taiCount - xiuCount)} về ${lech} → ${prediction})`,
      patternId: 'tong_phan_tich'
    };
  }
  
  return { detected: false };
}

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recent8 = results.slice(0, 8);
  const taiCount = recent8.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'xu_huong_manh');
  
  if (taiCount >= 6) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(80 + taiCount * 2),
      name: `Xu Hướng Mạnh (${taiCount}/8 Tài → Đảo Xỉu)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  if (taiCount <= 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(80 + (8 - taiCount) * 2),
      name: `Xu Hướng Mạnh (${8 - taiCount}/8 Xỉu → Đảo Tài)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  return { detected: false };
}

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  
  const recent5 = results.slice(0, 5);
  const weight = getPatternWeight(type, 'dao_chieu');
  
  let isAlternating = true;
  for (let i = 0; i < recent5.length - 1; i++) {
    if (recent5[i] === recent5[i + 1]) {
      isAlternating = false;
      break;
    }
  }
  
  if (isAlternating) {
    const prediction = recent5[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 75,
      name: `Đảo Chiều (Chuỗi ${recent5.join('-')} → ${prediction})`,
      patternId: 'dao_chieu'
    };
  }
  
  return { detected: false };
}

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  
  let streakType = results[0];
  let streakLength = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    
    let shouldBreak = streakLength >= 5;
    let confidence = 65;
    
    if (streakLength >= 7) {
      shouldBreak = true;
      confidence = 85;
    } else if (streakLength >= 5) {
      shouldBreak = true;
      confidence = 75;
    } else if (streakLength >= 3) {
      shouldBreak = false;
      confidence = 68;
    }
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round(confidence * weight),
      name: `Cầu Bệt ${streakLength} phiên ${streakType}`,
      patternId: 'cau_bet'
    };
  }
  
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 4) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    const confidence = Math.min(80, 65 + alternatingLength * 2);
    
    return { 
      detected: true, 
      length: alternatingLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(confidence * weight),
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      patternId: 'cau_dao_11'
    };
  }
  
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) {
        isAlternating = false;
        break;
      }
    }
    
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const weight = getPatternWeight(type, 'cau_22');
      
      return { 
        detected: true, 
        pairCount,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(78, 65 + pairCount * 3) * weight),
        name: `Cầu 2-2 (${pairCount} cặp)`,
        patternId: 'cau_22'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else {
      break;
    }
  }
  
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    
    let prediction;
    if (currentPosition === 0) {
      prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastTripleType;
    }
    
    return { 
      detected: true, 
      tripleCount,
      prediction,
      confidence: Math.round(Math.min(80, 68 + tripleCount * 4) * weight),
      name: `Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33'
    };
  }
  
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  
  const pattern1 = results.slice(0, 4);
  
  if (pattern1[0] !== pattern1[1] && 
      pattern1[1] === pattern1[2] && 
      pattern1[2] !== pattern1[3] &&
      pattern1[0] === pattern1[3]) {
    const weight = getPatternWeight(type, 'cau_121');
    return { 
      detected: true, 
      pattern: '1-2-1',
      prediction: pattern1[0],
      confidence: Math.round(72 * weight),
      name: 'Cầu 1-2-1',
      patternId: 'cau_121'
    };
  }
  
  return { detected: false };
}

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      const weight = getPatternWeight(type, 'cau_123');
      return { 
        detected: true, 
        pattern: '1-2-3',
        prediction: first,
        confidence: Math.round(74 * weight),
        name: 'Cầu 1-2-3',
        patternId: 'cau_123'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    const weight = getPatternWeight(type, 'cau_321');
    return { 
      detected: true, 
      pattern: '3-2-1',
      prediction: next2[0],
      confidence: Math.round(76 * weight),
      name: 'Cầu 3-2-1',
      patternId: 'cau_321'
    };
  }
  
  return { detected: false };
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const weight = getPatternWeight(type, 'cau_nhay_coc');
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0],
        confidence: Math.round(68 * weight),
        name: 'Cầu Nhảy Cóc',
        patternId: 'cau_nhay_coc'
      };
    }
    
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) {
        alternating = false;
        break;
      }
    }
    
    if (alternating && skipPattern.length >= 3) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(66 * weight),
        name: 'Cầu Nhảy Cóc Đảo',
        patternId: 'cau_nhay_coc'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_nhip_nghieng');
  
  if (taiCount5 >= 4) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Tài',
      confidence: Math.round(70 * weight),
      name: `Cầu Nhịp Nghiêng (${taiCount5}/5 Tài)`,
      patternId: 'cau_nhip_nghieng'
    };
  } else if (taiCount5 <= 1) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Xỉu',
      confidence: Math.round(70 * weight),
      name: `Cầu Nhịp Nghiêng (${5 - taiCount5}/5 Xỉu)`,
      patternId: 'cau_nhip_nghieng'
    };
  }
  
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_3van1');
  
  if (taiCount === 3) {
    return { 
      detected: true, 
      prediction: 'Xỉu',
      confidence: Math.round(68 * weight),
      name: 'Cầu 3 Ván 1 (3T-1X) → Xỉu',
      patternId: 'cau_3van1'
    };
  } else if (taiCount === 1) {
    return { 
      detected: true, 
      prediction: 'Tài',
      confidence: Math.round(68 * weight),
      name: 'Cầu 3 Ván 1 (3X-1T) → Tài',
      patternId: 'cau_3van1'
    };
  }
  
  return { detected: false };
}

function analyzeCauBeCau(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recentStreak = analyzeCauBet(results, type);
  
  if (recentStreak.detected && recentStreak.length >= 4) {
    const beforeStreak = results.slice(recentStreak.length, recentStreak.length + 4);
    const previousPattern = analyzeCauBet(beforeStreak, type);
    
    if (previousPattern.detected && previousPattern.type !== recentStreak.type) {
      const weight = getPatternWeight(type, 'cau_be_cau');
      return { 
        detected: true, 
        prediction: recentStreak.type === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(76 * weight),
        name: 'Cầu Bẻ Cầu',
        patternId: 'cau_be_cau'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  
  return { 
    detected: true, 
    prediction: results[0],
    confidence: Math.round(60 * weight),
    name: 'Cầu Tự Nhiên (Theo Ván Trước)',
    patternId: 'cau_tu_nhien'
  };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_rong');
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 6) {
    return { 
      detected: true, 
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(88, 75 + streakLength) * weight),
      name: `Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
  }
  
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'smart_bet');
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(78 * weight),
      name: `Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X → ${taiPrev5}T-${5-taiPrev5}X)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(82 * weight),
      name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X) → Đảo`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_streak') || 1.0;
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 5) {
    const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(85, 70 + streakLength) * weight),
      name: `Bẻ Chuỗi ${streakLength} (${streakType} → ${prediction})`,
      patternId: 'break_streak'
    };
  }
  
  return { detected: false };
}

function analyzeAlternatingBreak(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'alternating_break') || 1.0;
  
  let alternatingCount = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] !== results[i + 1]) {
      alternatingCount++;
    } else {
      break;
    }
  }
  
  if (alternatingCount >= 6) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(82, 68 + alternatingCount) * weight),
      name: `Bẻ Đảo ${alternatingCount} phiên → ${prediction}`,
      patternId: 'alternating_break'
    };
  }
  
  return { detected: false };
}

function analyzeDoublePairBreak(results, type) {
  if (results.length < 8) return { detected: false };
  
  const weight = getPatternWeight(type, 'double_pair_break') || 1.0;
  
  const isPair1 = results[0] === results[1];
  const isPair2 = results[2] === results[3];
  const isPair3 = results[4] === results[5];
  const isPair4 = results[6] === results[7];
  
  if (isPair1 && isPair2 && isPair3 && isPair4) {
    const pairType1 = results[0];
    const pairType2 = results[2];
    
    const allSamePair = pairType1 === pairType2 && pairType2 === results[4] && results[4] === results[6];
    if (allSamePair) {
      const prediction = pairType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(84 * weight),
        name: `4 Cặp Cùng ${pairType1} → Bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
    
    const alternatingPairs = pairType1 !== pairType2 && pairType2 !== results[4] && results[4] !== results[6];
    if (alternatingPairs) {
      const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(78 * weight),
        name: `Cặp Đảo Xen Kẽ → Bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
  }
  
  return { detected: false };
}

function analyzeTriplePattern(results, type) {
  if (results.length < 9) return { detected: false };
  
  const weight = getPatternWeight(type, 'triple_pattern') || 1.0;
  
  const isTriple1 = results[0] === results[1] && results[1] === results[2];
  const isTriple2 = results[3] === results[4] && results[4] === results[5];
  const isTriple3 = results[6] === results[7] && results[7] === results[8];
  
  if (isTriple1 && isTriple2 && isTriple3) {
    const tripleType1 = results[0];
    const tripleType2 = results[3];
    const tripleType3 = results[6];
    
    if (tripleType1 === tripleType2 && tripleType2 === tripleType3) {
      const prediction = tripleType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(88 * weight),
        name: `3 Bộ Ba Cùng ${tripleType1} → Bẻ ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
    
    if (tripleType1 !== tripleType2 && tripleType2 !== tripleType3) {
      const prediction = tripleType1;
      return {
        detected: true,
        prediction,
        confidence: Math.round(80 * weight),
        name: `Bộ Ba Đảo → Theo ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
  }
  
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const xiuCount = window.length - taiCount;
  
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: (xiuCount / window.length) * 100,
    taiCount,
    xiuCount,
    total: window.length,
    imbalance: Math.abs(taiCount - xiuCount) / window.length
  };
}

// ==================== PATTERN MỚI TỪ SUNPHHUY (DỰ ĐOÁN) ====================

function analyzeCauGay(results, type) {
    if (results.length < 5) return { detected: false };
    
    const arr = results.slice(0, 6);
    const weight = getPatternWeight(type, 'cau_gay') || 1.0;
    
    if (arr[0] === arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[3] === arr[4]) {
        return {
            detected: true,
            prediction: arr[3],
            confidence: Math.round(74 * weight),
            name: `Gãy 3-2 (${arr[0]}${arr[0]}${arr[0]}${arr[3]}${arr[3]} → ${arr[3]})`,
            patternId: 'cau_gay'
        };
    }
    
    if (arr[0] === arr[1] && arr[1] !== arr[2] && arr[2] === arr[3] && arr[3] === arr[4]) {
        return {
            detected: true,
            prediction: arr[2],
            confidence: Math.round(74 * weight),
            name: `Gãy 2-3 (${arr[0]}${arr[0]}${arr[2]}${arr[2]}${arr[2]} → ${arr[2]})`,
            patternId: 'cau_gay'
        };
    }
    
    if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
        return {
            detected: true,
            prediction: arr[1],
            confidence: Math.round(72 * weight),
            name: `Gãy 1-2-1 (${arr[0]}${arr[1]}${arr[1]}${arr[0]} → ${arr[1]})`,
            patternId: 'cau_gay'
        };
    }
    
    return { detected: false };
}

function analyzeMauLap(results, type) {
    if (results.length < 6) return { detected: false };
    
    const arr = results.slice(0, 10);
    const weight = getPatternWeight(type, 'mau_lap') || 1.0;
    
    for (let len = 2; len <= 4; len++) {
        let pattern = arr.slice(0, len);
        for (let i = len; i < arr.length - len; i++) {
            let sub = arr.slice(i, i + len);
            if (JSON.stringify(sub) === JSON.stringify(pattern)) {
                let nextIndex = i + len;
                if (nextIndex < arr.length) {
                    return {
                        detected: true,
                        prediction: arr[nextIndex],
                        confidence: Math.round(88 * weight),
                        name: `Mẫu Lặp "${pattern.join('-')}" → ${arr[nextIndex]}`,
                        patternId: 'mau_lap'
                    };
                }
            }
        }
    }
    return { detected: false };
}

function analyzeVi(data, type) {
    if (data.length < 5) return { detected: false };
    
    const points = data.slice(0, 6).map(d => d.Tong);
    const weight = getPatternWeight(type, 'vi_phan_tich') || 1.0;
    
    const last = points[0];
    const prev = points[1];
    const slice = points.slice(0, 5);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    
    if (last >= 15) {
        return {
            detected: true,
            prediction: 'Xỉu',
            confidence: Math.round(75 * weight),
            name: `Vị Cực Đại (Tổng ${last} → Xỉu)`,
            patternId: 'vi_phan_tich'
        };
    }
    
    if (last <= 5) {
        return {
            detected: true,
            prediction: 'Tài',
            confidence: Math.round(75 * weight),
            name: `Vị Cực Tiểu (Tổng ${last} → Tài)`,
            patternId: 'vi_phan_tich'
        };
    }
    
    if (avg > 11 && last > prev) {
        return {
            detected: true,
            prediction: 'Xỉu',
            confidence: Math.round(68 * weight),
            name: `Vị Bão Hòa (TB ${avg.toFixed(1)}, tăng → Xỉu)`,
            patternId: 'vi_phan_tich'
        };
    }
    
    if (avg < 10 && last < prev) {
        return {
            detected: true,
            prediction: 'Tài',
            confidence: Math.round(68 * weight),
            name: `Vị Cạn Kiệt (TB ${avg.toFixed(1)}, giảm → Tài)`,
            patternId: 'vi_phan_tich'
        };
    }
    
    if (avg >= 11 && last >= 11 && last <= 13) {
        return {
            detected: true,
            prediction: 'Tài',
            confidence: Math.round(65 * weight),
            name: `Vị Ổn Định Tài (TB ${avg.toFixed(1)}, ${last})`,
            patternId: 'vi_phan_tich'
        };
    }
    
    if (avg <= 9 && last >= 7 && last <= 9) {
        return {
            detected: true,
            prediction: 'Xỉu',
            confidence: Math.round(65 * weight),
            name: `Vị Ổn Định Xỉu (TB ${avg.toFixed(1)}, ${last})`,
            patternId: 'vi_phan_tich'
        };
    }
    
    return { detected: false };
}

// ==================== HÀM TÍNH TOÁN DỰ ĐOÁN CHÍNH ====================

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // 1. Tổng phân tích
  const tongPhanTich = analyzeTongPhanTich(last50, type);
  if (tongPhanTich.detected) {
    predictions.push({ prediction: tongPhanTich.prediction, confidence: tongPhanTich.confidence, priority: 15, name: tongPhanTich.name });
    factors.push(tongPhanTich.name);
    allPatterns.push(tongPhanTich);
  }
  
  // 2. Xu hướng mạnh
  const xuHuongManh = analyzeXuHuongManh(results, type);
  if (xuHuongManh.detected) {
    predictions.push({ prediction: xuHuongManh.prediction, confidence: xuHuongManh.confidence, priority: 14, name: xuHuongManh.name });
    factors.push(xuHuongManh.name);
    allPatterns.push(xuHuongManh);
  }
  
  // 3. Đảo chiều
  const daoChieu = analyzeDaoChieu(results, type);
  if (daoChieu.detected) {
    predictions.push({ prediction: daoChieu.prediction, confidence: daoChieu.confidence, priority: 13, name: daoChieu.name });
    factors.push(daoChieu.name);
    allPatterns.push(daoChieu);
  }
  
  // 4. Cầu Rồng
  const cauRong = analyzeCauRong(results, type);
  if (cauRong.detected) {
    predictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 12, name: cauRong.name });
    factors.push(cauRong.name);
    allPatterns.push(cauRong);
  }
  
  // 5. Bẻ chuỗi
  const breakStreak = analyzeBreakStreak(results, type);
  if (breakStreak.detected) {
    predictions.push({ prediction: breakStreak.prediction, confidence: breakStreak.confidence, priority: 11, name: breakStreak.name });
    factors.push(breakStreak.name);
    allPatterns.push(breakStreak);
  }
  
  // 6. Triple pattern
  const triplePattern = analyzeTriplePattern(results, type);
  if (triplePattern.detected) {
    predictions.push({ prediction: triplePattern.prediction, confidence: triplePattern.confidence, priority: 11, name: triplePattern.name });
    factors.push(triplePattern.name);
    allPatterns.push(triplePattern);
  }
  
  // 7. Double pair break
  const doublePairBreak = analyzeDoublePairBreak(results, type);
  if (doublePairBreak.detected) {
    predictions.push({ prediction: doublePairBreak.prediction, confidence: doublePairBreak.confidence, priority: 10, name: doublePairBreak.name });
    factors.push(doublePairBreak.name);
    allPatterns.push(doublePairBreak);
  }
  
  // 8. Smart bet
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) {
    predictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 10, name: smartBet.name });
    factors.push(smartBet.name);
    allPatterns.push(smartBet);
  }
  
  // 9. Cầu bệt
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) {
    predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 9, name: cauBet.name });
    factors.push(cauBet.name);
    allPatterns.push(cauBet);
  }
  
  // 10. Cầu đảo 1-1
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) {
    predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 9, name: cauDao11.name });
    factors.push(cauDao11.name);
    allPatterns.push(cauDao11);
  }
  
  // 11. Cầu 2-2
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) {
    predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 8, name: cau22.name });
    factors.push(cau22.name);
    allPatterns.push(cau22);
  }
  
  // 12. Cầu 3-3
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) {
    predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 8, name: cau33.name });
    factors.push(cau33.name);
    allPatterns.push(cau33);
  }
  
  // 13. Cầu 1-2-1
  const cau121 = analyzeCau121(results, type);
  if (cau121.detected) {
    predictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: 7, name: cau121.name });
    factors.push(cau121.name);
    allPatterns.push(cau121);
  }
  
  // 14. Cầu 1-2-3
  const cau123 = analyzeCau123(results, type);
  if (cau123.detected) {
    predictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 7, name: cau123.name });
    factors.push(cau123.name);
    allPatterns.push(cau123);
  }
  
  // 15. Cầu 3-2-1
  const cau321 = analyzeCau321(results, type);
  if (cau321.detected) {
    predictions.push({ prediction: cau321.prediction, confidence: cau321.confidence, priority: 7, name: cau321.name });
    factors.push(cau321.name);
    allPatterns.push(cau321);
  }
  
  // 16. Cầu bẻ cầu
  const cauBeCau = analyzeCauBeCau(results, type);
  if (cauBeCau.detected) {
    predictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 8, name: cauBeCau.name });
    factors.push(cauBeCau.name);
    allPatterns.push(cauBeCau);
  }
  
  // 17. Cầu nhịp nghiêng
  const cauNhipNghieng = analyzeCauNhipNghieng(results, type);
  if (cauNhipNghieng.detected) {
    predictions.push({ prediction: cauNhipNghieng.prediction, confidence: cauNhipNghieng.confidence, priority: 7, name: cauNhipNghieng.name });
    factors.push(cauNhipNghieng.name);
    allPatterns.push(cauNhipNghieng);
  }
  
  // 18. Cầu 3 ván 1
  const cau3Van1 = analyzeCau3Van1(results, type);
  if (cau3Van1.detected) {
    predictions.push({ prediction: cau3Van1.prediction, confidence: cau3Van1.confidence, priority: 6, name: cau3Van1.name });
    factors.push(cau3Van1.name);
    allPatterns.push(cau3Van1);
  }
  
  // 19. Cầu nhảy cóc
  const cauNhayCoc = analyzeCauNhayCoc(results, type);
  if (cauNhayCoc.detected) {
    predictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 6, name: cauNhayCoc.name });
    factors.push(cauNhayCoc.name);
    allPatterns.push(cauNhayCoc);
  }
  
  // 20. Alternating break
  const alternatingBreak = analyzeAlternatingBreak(results, type);
  if (alternatingBreak.detected) {
    predictions.push({ prediction: alternatingBreak.prediction, confidence: alternatingBreak.confidence, priority: 8, name: alternatingBreak.name });
    factors.push(alternatingBreak.name);
    allPatterns.push(alternatingBreak);
  }
  
  // 21. Phân bố lệch
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.15) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    predictions.push({ prediction: minority, confidence: 65, priority: 5, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  // 22. Cầu Gãy (từ sunphhuy)
  const cauGay = analyzeCauGay(results, type);
  if (cauGay.detected) {
    predictions.push({ prediction: cauGay.prediction, confidence: cauGay.confidence, priority: 8, name: cauGay.name });
    factors.push(cauGay.name);
    allPatterns.push(cauGay);
  }
  
  // 23. Mẫu Lặp (từ sunphhuy)
  const mauLap = analyzeMauLap(results, type);
  if (mauLap.detected) {
    predictions.push({ prediction: mauLap.prediction, confidence: mauLap.confidence, priority: 9, name: mauLap.name });
    factors.push(mauLap.name);
    allPatterns.push(mauLap);
  }
  
  // 24. Phân tích Vị (từ sunphhuy)
  const viPhanTich = analyzeVi(last50, type);
  if (viPhanTich.detected) {
    predictions.push({ prediction: viPhanTich.prediction, confidence: viPhanTich.confidence, priority: 8, name: viPhanTich.name });
    factors.push(viPhanTich.name);
    allPatterns.push(viPhanTich);
  }
  
  // Nếu không có pattern nào, dùng cầu tự nhiên
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  // Sắp xếp theo priority và confidence
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  // Tính điểm cho Tài và Xỉu
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  // Điều chỉnh theo lịch sử thắng/thua
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -3) {
    if (taiScore > xiuScore) {
      xiuScore *= 1.3;
    } else {
      taiScore *= 1.3;
    }
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // Điều chỉnh thông minh
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  // Tính confidence
  let baseConfidence = 65;
  
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 65) * 0.3;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 10);
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  
  // Giới hạn confidence 60-92%
  finalConfidence = Math.max(60, Math.min(92, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore,
      xiuScore,
      topPattern: predictions[0]?.name || 'N/A',
      distribution,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak
      }
    }
  };
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    Do_tin_cay: `${confidence}%`,
    ket_qua_du_doan: '',
    id: '@tranhoang2286',
    timestamp: new Date().toISOString()
  };
  
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`
╔═══════════════════════════════════════════╗
║     🦀 LẨU CUA 79 - TÀI XỈU API         ║
║     ID: @tranhoang2286                   ║
╚═══════════════════════════════════════════╝

📌 CÁC LỆNH CÓ SẴN:

🔹 /lc79-hu           - Dự đoán Tài Xỉu Hũ
🔹 /lc79-md5          - Dự đoán Tài Xỉu MD5
🔹 /lc79-hu/lichsu    - Lịch sử dự đoán Hũ
🔹 /lc79-md5/lichsu   - Lịch sử dự đoán MD5
🔹 /lc79-hu/analysis  - Phân tích chi tiết Hũ
🔹 /lc79-md5/analysis - Phân tích chi tiết MD5
🔹 /lc79-hu/learning  - Thống kê học tập Hũ
🔹 /lc79-md5/learning - Thống kê học tập MD5
🔹 /reset-learning    - Reset dữ liệu học

📊 **MỚI - HỆ THỐNG LƯU TRỮ CẦU VÔ HẠN:**
🔹 /patterns/stats    - Xem tổng số cầu đã học
🔹 /patterns/list     - Danh sách tất cả cầu đã học
🔹 /patterns/type/:type - Xem cầu theo loại
🔹 /patterns/high     - Cầu có độ chính xác cao (>70%)
🔹 /patterns/similar  - Tìm cầu tương tự

📊 CÁC PATTERN PHÂN TÍCH:
✅ Cầu Bệt | Cầu Đảo 1-1 | Cầu 2-2 | Cầu 3-3
✅ Cầu 1-2-1 | Cầu 1-2-3 | Cầu 3-2-1
✅ Cầu Nhảy Cóc | Cầu Nhịp Nghiêng | Cầu 3 Ván 1
✅ Cầu Bẻ Cầu | Cầu Rồng | Cầu Tự Nhiên
✅ Tổng Phân Tích | Xu Hướng Mạnh | Đảo Chiều
✅ Bẻ Chuỗi | Bẻ Đảo | 4 Cặp | 3 Bộ Ba
✅ Phân bố lệch | Smart Bet
✅ **MỚI:** Cầu Gãy | Mẫu Lặp | Phân tích Vị

📁 FILE: tranhoang2286.json, tranhoang2286_history.json, pattern_database.json
🔄 Auto-save: mỗi 30 giây
📚 Lưu trữ cầu: KHÔNG GIỚI HẠN
  `);
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'hu');
    
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => {
      await updateHistoryStatus('hu');
    }, 5000);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      Do_tin_cay: record.Do_tin_cay,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'md5');
    
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => {
      await updateHistoryStatus('md5');
    }, 5000);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      Do_tin_cay: record.Do_tin_cay,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('hu');
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length
    });
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length
    });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('md5');
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length
    });
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length
    });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/learning', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    streakAnalysis: stats.streakAnalysis
  });
});

app.get('/lc79-md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5 - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    streakAnalysis: stats.streakAnalysis
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: []
    },
    md5: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: []
    }
  };
  saveLearningData();
  res.json({ message: 'Learning data reset successfully' });
});

// ==================== ENDPOINTS QUẢN LÝ CẦU ====================

// Xem tổng số cầu đã học
app.get('/patterns/stats', (req, res) => {
  res.json({
    totalPatterns: patternDatabase.totalPatterns,
    totalLearned: patternDatabase.stats.totalLearned,
    byType: patternDatabase.stats.byType,
    byConfidence: patternDatabase.stats.byConfidence,
    accuracyByType: patternDatabase.stats.accuracyByType,
    lastUpdated: patternDatabase.lastUpdated
  });
});

// Danh sách tất cả cầu
app.get('/patterns/list', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  
  const patterns = patternDatabase.patterns.slice(offset, offset + limit);
  res.json({
    total: patternDatabase.totalPatterns,
    limit,
    offset,
    patterns: patterns.map(p => ({
      id: p.id,
      type: p.type,
      name: p.name,
      prediction: p.prediction,
      confidence: p.confidence,
      accuracy: p.accuracy.toFixed(2) + '%',
      occurrences: p.totalOccurrences,
      firstSeen: p.firstSeen,
      lastSeen: p.lastSeen
    }))
  });
});

// Xem cầu theo loại
app.get('/patterns/type/:type', (req, res) => {
  const { type } = req.params;
  const patterns = getPatternsByType(type);
  
  res.json({
    type,
    total: patterns.length,
    patterns: patterns.map(p => ({
      id: p.id,
      name: p.name,
      prediction: p.prediction,
      confidence: p.confidence,
      accuracy: p.accuracy.toFixed(2) + '%',
      occurrences: p.totalOccurrences,
      lastSeen: p.lastSeen
    }))
  });
});

// Xem cầu có độ chính xác cao
app.get('/patterns/high', (req, res) => {
  const minAccuracy = parseFloat(req.query.min) || 70;
  const patterns = getHighAccuracyPatterns(minAccuracy);
  
  res.json({
    minAccuracy,
    total: patterns.length,
    patterns: patterns.map(p => ({
      id: p.id,
      type: p.type,
      name: p.name,
      prediction: p.prediction,
      accuracy: p.accuracy.toFixed(2) + '%',
      occurrences: p.totalOccurrences
    }))
  });
});

// Tìm cầu tương tự
app.post('/patterns/similar', (req, res) => {
  const { pattern, maxResults = 10 } = req.body;
  
  if (!pattern || !Array.isArray(pattern) || pattern.length === 0) {
    return res.status(400).json({ error: 'Vui lòng cung cấp pattern để tìm' });
  }
  
  const similar = findSimilarPatterns(pattern, maxResults);
  
  res.json({
    pattern,
    totalFound: similar.length,
    patterns: similar.map(p => ({
      id: p.id,
      type: p.type,
      name: p.name,
      prediction: p.prediction,
      accuracy: p.accuracy.toFixed(2) + '%',
      confidence: p.confidence,
      occurrences: p.totalOccurrences
    }))
  });
});

// Lấy chi tiết một cầu
app.get('/patterns/:id', (req, res) => {
  const { id } = req.params;
  const pattern = patternDatabase.patterns.find(p => p.id === id);
  
  if (!pattern) {
    return res.status(404).json({ error: 'Không tìm thấy cầu' });
  }
  
  res.json(pattern);
});

// ==================== KHỞI ĐỘNG ====================

// Khởi tạo pattern database
initializePatternDatabase();

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════');
  console.log('🦀 LẨU CUA 79 - TÀI XỈU PREDICTION API');
  console.log('═══════════════════════════════════════════');
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`📌 ID: @tranhoang2286`);
  console.log('');
  console.log('📌 CÁC LỆNH CÓ SẴN:');
  console.log('  🔹 /lc79-hu           - Dự đoán Tài Xỉu Hũ');
  console.log('  🔹 /lc79-md5          - Dự đoán Tài Xỉu MD5');
  console.log('  🔹 /lc79-hu/lichsu    - Lịch sử dự đoán Hũ');
  console.log('  🔹 /lc79-md5/lichsu   - Lịch sử dự đoán MD5');
  console.log('  🔹 /lc79-hu/analysis  - Phân tích chi tiết Hũ');
  console.log('  🔹 /lc79-md5/analysis - Phân tích chi tiết MD5');
  console.log('  🔹 /lc79-hu/learning  - Thống kê học tập Hũ');
  console.log('  🔹 /lc79-md5/learning - Thống kê học tập MD5');
  console.log('  🔹 /reset-learning    - Reset dữ liệu học');
  console.log('');
  console.log('📊 **MỚI - HỆ THỐNG LƯU TRỮ CẦU VÔ HẠN:**');
  console.log('  🔹 /patterns/stats    - Xem tổng số cầu đã học');
  console.log('  🔹 /patterns/list     - Danh sách tất cả cầu đã học');
  console.log('  🔹 /patterns/type/:type - Xem cầu theo loại');
  console.log('  🔹 /patterns/high     - Cầu có độ chính xác cao (>70%)');
  console.log('  🔹 /patterns/similar  - Tìm cầu tương tự');
  console.log('  🔹 /patterns/:id      - Chi tiết một cầu');
  console.log('');
  console.log('📊 CÁC PATTERN PHÂN TÍCH:');
  console.log('  ✅ Cầu Bệt | Cầu Đảo 1-1 | Cầu 2-2 | Cầu 3-3');
  console.log('  ✅ Cầu 1-2-1 | Cầu 1-2-3 | Cầu 3-2-1');
  console.log('  ✅ Cầu Nhảy Cóc | Cầu Nhịp Nghiêng | Cầu 3 Ván 1');
  console.log('  ✅ Cầu Bẻ Cầu | Cầu Rồng | Cầu Tự Nhiên');
  console.log('  ✅ Tổng Phân Tích | Xu Hướng Mạnh | Đảo Chiều');
  console.log('  ✅ Bẻ Chuỗi | Bẻ Đảo | 4 Cặp | 3 Bộ Ba');
  console.log('  ✅ Phân bố lệch | Smart Bet');
  console.log('  ✅ **MỚI:** Cầu Gãy | Mẫu Lặp | Phân tích Vị');
  console.log('');
  console.log('📁 FILE: tranhoang2286.json, tranhoang2286_history.json, pattern_database.json');
  console.log('🔄 Auto-save: mỗi 30 giây');
  console.log(`📚 Lưu trữ cầu: KHÔNG GIỚI HẠN (${patternDatabase.totalPatterns} cầu đã học)`);
  console.log('═══════════════════════════════════════════');
  
  startAutoSaveTask();
});
