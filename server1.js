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

// Middleware: habilita CORS y soporte para JSON
app.use(cors());
app.use(express.json());

// Definición de directorios de trabajo (subidas, salidas, temporales)
const uploadsDir = "uploads";
const outputsDir = "outputs";
const tempDir = "temp";

// Crear los directorios si no existen
[uploadsDir, outputsDir, tempDir].forEach(dir => {
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
});

// Almacenamiento de trabajos activos de conversión
const activeJobs = new Map();

// Emisor de eventos para seguimiento de estado de trabajos (SSE)
class JobEmitter extends EventEmitter {}
const jobEmitter = new JobEmitter();

// Presets de conversión de video predefinidos
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

// Configuración de almacenamiento de archivos con multer
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// Configuración de límites y filtros para archivos subidos
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
      cb(new Error('Solo se permiten archivos de video y audio'), false);
    }
  }
});

// Manejo de errores de multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Archivo demasiado grande (máx 500MB)' });
    }
    return res.status(400).json({ error: error.message });
  }

  if (error.message === 'Solo se permiten archivos de video y audio') {
    return res.status(400).json({ error: error.message });
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Función de limpieza de archivos temporales
const cleanupFiles = async (...filePaths) => {
  const cleanupPromises = filePaths.map(async (filePath) => {
    if (filePath && fsSync.existsSync(filePath)) {
      try {
        await fs.unlink(filePath);
        console.log('Cleaned up:', filePath);
      } catch (err) {
        console.error('Error deleting file:', filePath, err);
      }
    }
  });
  
  await Promise.all(cleanupPromises);
};

// Obtener información técnica de un archivo multimedia con ffprobe
const getMediaInfo = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
        
        resolve({
          duration: metadata.format.duration,
          size: metadata.format.size,
          bitrate: metadata.format.bit_rate,
          format: metadata.format.format_name,
          video: videoStream ? {
            codec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            fps: eval(videoStream.r_frame_rate),
            bitrate: videoStream.bit_rate
          } : null,
          audio: audioStream ? {
            codec: audioStream.codec_name,
            channels: audioStream.channels,
            sampleRate: audioStream.sample_rate,
            bitrate: audioStream.bit_rate
          } : null
        });
      }
    });
  });
};

// Formatear tamaño de archivo en unidades legibles
const formatSize = (bytes) => {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
};

// Función principal para convertir video con ffmpeg y presets
const convertVideo = async (jobId, inputPath, outputPath, options = {}) => {
  const {
    preset = 'balanced',
    resolution = null,
    format = 'mp4',
    startTime = null,
    duration = null,
    removeAudio = false,
    customOptions = []
  } = options;

  const presetConfig = PRESETS[preset] || PRESETS['balanced'];
  const job = activeJobs.get(jobId);
  
  let command = ffmpeg(inputPath);