const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

const app = express();

// Enable CORS for frontend integration
app.use(cors());
app.use(express.json());

// Create directories if they don't exist
const uploadsDir = "uploads";
const outputsDir = "outputs";
const tempDir = "temp";

[uploadsDir, outputsDir, tempDir].forEach(dir => {
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
});

// Store active conversion jobs
const activeJobs = new Map();

// Job status emitter for SSE
class JobEmitter extends EventEmitter {}
const jobEmitter = new JobEmitter();

// Video conversion presets
const PRESETS = {
  'high-quality': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 18,
    preset: 'slow',
    audioBitrate: '256k'
  },
  'balanced': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '192k'
  },
  'fast': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 28,
    preset: 'fast',
    audioBitrate: '128k'
  },
  'av1': {
    videoCodec: 'libaom-av1',
    audioCodec: 'opus',
    crf: 30,
    preset: 6,
    audioBitrate: '128k'
  },
  'web-optimized': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    extraOptions: ['-movflags', '+faststart', '-profile:v', 'main', '-level', '4.0']
  }
};

// Enhanced multer configuration
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.hevc', '.h265', 
                            '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.ogv', '.mts', '.m2ts'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (file.mimetype.startsWith('video/') || 
        file.mimetype.startsWith('audio/') || 
        videoExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Only video and audio files are allowed'), false);
    }
  }
});
